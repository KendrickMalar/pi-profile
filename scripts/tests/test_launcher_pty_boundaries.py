import importlib.util
import unittest
from pathlib import Path
from unittest.mock import patch

SCRIPT = Path(__file__).resolve().parents[1] / "test-profile-launcher-cli.py"
spec = importlib.util.spec_from_file_location("launcher_boundaries", SCRIPT)
assert spec is not None and spec.loader is not None
launcher = importlib.util.module_from_spec(spec)
spec.loader.exec_module(launcher)
base = launcher.base


class ExitDuringPoll:
    def __init__(self):
        self.calls = 0

    def poll(self):
        self.calls += 1
        return None if self.calls == 1 else 130


class LauncherPTYBoundaries(unittest.TestCase):
    def child(self):
        child = base.Child.__new__(base.Child)
        child.data = b""
        child.screen = base.TerminalScreen(24, 80)
        child.pump = lambda *args: None
        child.p = ExitDuringPoll()
        child.master = 123
        return child

    def test_exit_between_predicate_and_poll_satisfies_exit_wait(self):
        child = self.child()
        child.wait(lambda: child.p.poll() is not None)
        self.assertEqual(child.p.poll(), 130)

    def test_exit_does_not_satisfy_false_output_predicate(self):
        child = self.child()
        with self.assertRaisesRegex(AssertionError, "timeout/exit"):
            child.wait(lambda: "required output" in child.text())

    def test_selected_row_does_not_finish_partial_cli_frame(self):
        row = "\x1b[2K│  ● Development   💻\r\n".encode()
        footer = "\x1b[2K\x1b[2m└  ↑↓ 選択  ·  Enter 開始  ·  Esc Other  ·  Ctrl-C 中止".encode()
        complete = launcher.cli_profile_frame_complete
        self.assertFalse(complete(row, "Development", color=True))
        self.assertFalse(complete(row + footer, "Development", color=True))
        self.assertFalse(complete(row + footer + b"\x1b[22", "Development", color=True))
        self.assertTrue(complete(row + footer + b"\x1b[22m", "Development", color=True))
        self.assertTrue(complete(row + footer, "Development", color=False))
        self.assertFalse(complete(row + footer + b"\x1b[22m", "Research", color=True))
        self.assertFalse(complete(row + footer + b"\x1b[22m" + row, "Development", color=True))
        missing_cancel_hint = (row + footer + b"\x1b[22m").replace(b"Esc Other", b"")
        self.assertFalse(complete(missing_cancel_hint, "Development", color=True))

    def test_frame_wait_drains_old_width_footer_before_resize(self):
        child = self.child()
        chunks = [
            "\x1b[2K│  ● Development   💻\r\n".encode(),
            "\x1b[2K\x1b[2m└  ↑↓ 選択  ·  Enter 開始  ·  Esc Other  ·  Ctrl-C 中止\x1b[22m".encode(),
        ]
        consumed = []

        def pump(*args):
            chunk = chunks.pop(0)
            consumed.append(chunk)
            child.data += chunk
            child.screen.feed(chunk)

        child.pump = pump
        # This fake stays live until the selected frame's footer arrives.
        child.p.poll = lambda: None
        case = launcher.Launcher("test_guided_focus_resize")
        case.env = {}
        with patch.object(base.termios, "tcgetattr", return_value=[0, 0, 0, 0]):
            case.wait_profile_frame(child, "Development")
        self.assertEqual(len(consumed), 2)
        self.assertEqual(child.screen.activity(), {"auto_wraps": 0, "scrolls": 0})
        child.screen.reset_activity()
        child.screen.resize(16, 40)
        self.assertEqual(child.screen.activity(), {"auto_wraps": 0, "scrolls": 0})

    def test_complete_frame_still_waits_for_raw_input(self):
        child = self.child()
        child.data = "\x1b[2K│  ● Research\r\n\x1b[2K\x1b[2m└  ↑↓ 選択 · Enter 開始 · Esc Other · Ctrl-C 中止\x1b[22m".encode()
        child.screen.feed(child.data)
        child.p.poll = lambda: None
        case = launcher.Launcher("test_guided_focus_resize")
        case.env = {}
        flags = [base.termios.ICANON | base.termios.ISIG | base.termios.ECHO, 0]
        with patch.object(base.termios, "tcgetattr", side_effect=lambda _: [0, 0, 0, flags.pop(0)]):
            case.wait_profile_frame(child, "Research")
        self.assertEqual(flags, [])

    def test_complete_wrapped_footer_keeps_all_hints(self):
        data = "\x1b[2K│  ● Development\r\n\x1b[2K\x1b[2m└  ↑↓ 選択  ·  Enter 開\x1b[22m\r\r\n\x1b[2K\x1b[2m   始  ·  Esc Other  ·\x1b[22m\r\r\n\x1b[2K\x1b[2m   Ctrl-C 中止\x1b[22m".encode()
        self.assertTrue(launcher.cli_profile_frame_complete(data, "Development", color=True))
        wrapped_words = data.replace(b"Esc Other", "Esc\r\r\n\x1b[2K\x1b[2m   Other".encode())
        self.assertTrue(launcher.cli_profile_frame_complete(wrapped_words, "Development", color=True))

    def test_frame_before_action_mark_cannot_satisfy_new_frame_wait(self):
        child = self.child()
        row = "\x1b[2K│  ● Research\r\n".encode()
        footer = "\x1b[2K\x1b[2m└  ↑↓ 選択 · Enter 開始 · Esc Other · Ctrl-C 中止\x1b[22m".encode()
        child.data = row + footer
        child.screen.feed(child.data)
        mark = len(child.data)
        chunks = [b"", row, footer]
        consumed = []

        def pump(*args):
            chunk = chunks.pop(0)
            consumed.append(chunk)
            child.data += chunk
            child.screen.feed(chunk)

        child.pump = pump
        child.p.poll = lambda: None
        case = launcher.Launcher("test_guided_focus_resize")
        case.env = {}
        with patch.object(base.termios, "tcgetattr", return_value=[0, 0, 0, 0]):
            case.wait_profile_frame(child, "Research", mark)
        self.assertEqual(len(consumed), 3)


if __name__ == "__main__":
    unittest.main()
