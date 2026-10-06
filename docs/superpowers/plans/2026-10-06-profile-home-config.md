# Personal Profile Home Separation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 個人Profileを `~/.pi/agent/profiles/` へ分離し、既存5種類を上書きなしで配置する。

**Architecture:** Profileルートをsession_startでホームまたはPI_PROFILE_DIRから解決する。拡張内のprofilesはサンプルに限定し、実運用の選択肢へ混ぜない。指示snapshotと追加リソース寿命は既存実装を維持し、初期コピーはユーザー承認後の一度限りの親操作とする。

**Tech Stack:** TypeScript、Node node:test、Pi公開API、Python unittest/PTY、loopbackモデル。

**Spec:** `docs/superpowers/specs/2026-10-06-profile-home-config-design.md`

## Global Constraints

- Pi 1.0.2と1.0.4、Node 26.10.0以上で検証。新しい実行時依存は追加しない。
- 既定の保存先はos.homedir()を基準とする `.pi/agent/profiles`。PI_CODING_AGENT_DIRでは変えない。
- PI_PROFILE_DIRの未設定・空文字は既定値。非空は絶対パスか~/のみ。相対・制御文字・空白だけは警告してOther、別ルートへフォールバックしない。
- 起動時の自動コピー、サンプルへのフォールバック、個人とサンプルの併合はしない。
- 会話version:1の指示本文は固定し、追加リソースだけ現在の保存先から読む。
- tools拡張パス拒否、パス境界、所有dispose、同名スキルの親子一致を維持する。
- 実装・依存セットアップ・ホーム初期配置・コミット/main統合はそれぞれ承認された範囲でのみ行う。push/公開・共有settings/認証・ランチャー変更は対象外。

## Review Focus

- 不正な明示ルートが実HOMEやサンプルへの読み込みへ落ちる。
- 複数認証アカウントで既定Profileルートが意図せず分かれる。
- 個人側から消したProfileがサンプル由来で復活する。
- 初期コピー直前に存在したファイル・symlinkを上書きする。
- 同じIDの保存会話が本文ごと差し替わる、または追加リソースが旧ルートに残る。

## Setup

- [ ] 計画と実行方法の承認を受け、専用worktree `profile-home-config` / branch `feat/profile-home-config` を確認する。既存の文書差分を保護する。
- [ ] 依存セットアップの許可後に、このworktree内だけで `npm ci --ignore-scripts` を実行する。別worktreeとnode_modulesを共有しない。
- [ ] `npm test`、`npm run typecheck`、`python3 -m unittest discover -s scripts/tests -v` を実行しbaselineを保存する。失敗を隠して進めない。

## Task 1: 外部ルートの解決と会話への接続

**Files:**
- Create `extensions/startup-profile/profile-root.ts`
- Modify `extensions/startup-profile/index.ts`
- Create `tests/startup-profile/profile-root.test.ts`
- Modify `tests/startup-profile/extension.test.ts` / `resource-lifecycle.test.ts`

**Interfaces:**
- `resolveProfileRoot(input: { home: string; override?: string }): { directory?: string; warning?: string }`。環境を直接読まない純粋関数。
- default exportの既存 `startupProfile(pi: ExtensionAPI, profilesRoot?: string): void` を維持。明示rootはテスト注入として優先し、省略時にsession_startで `homedir()` と `process.env.PI_PROFILE_DIR` を解決する。
- root不正時は `{profiles:[STANDARD_PROFILE],warnings:[diagnostic]}` 相当を使い、loadProfilesを別ルートに対して呼ばない。

- [ ] **RED:** `profile-root.test.ts`にdefault_home、absolute_override、tilde_override、empty_override、relative_rejected、control_rejected、whitespace_rejectedを追加する。期待値は `/fixture/home/.pi/agent/profiles`、`/fixture/custom` などのliteralでassertする。各PI_CODING_AGENT_DIRを変えても関数の既定値に影響しないケースを加える。
- [ ] **Run:** `node --experimental-strip-types --test tests/startup-profile/profile-root.test.ts`。新関数未実装または誤分岐によるFAILを記録する。
- [ ] **Implement:** homeとoverrideから絶対rootまたは診断を返す。~/をhomeに展開し、trimで異なる指定に黙って変換しない。末尾/やスペースを含む正当な絶対パスは通常pathとして扱うが、制御文字は拒否する。
- [ ] **RED:** extensionテストに、明示fixtureと既定ホームの分離、保存snapshotを保持したまま別rootの追加リソースを採用、invalid_root_restores_snapshot_only、missing_root_other_no_files_created、empty_root_no_bundled_profilesを追加する。環境を書き換える場合は復元とファイル単位の直列実行を保証する。
- [ ] **Implement:** session_startごとにrootを解決する。未配置・非ディレクトリを早期診断し、Otherを返す。正常rootでは既存loadProfilesを呼ぶ。resources_discoverはそこで決まった定義のみを使い、後からenvを読んで会話中ルート変更しない。
- [ ] **GREEN:** 対象テストと全 `npm test` / `npm run typecheck` を実行。旧snapshot、不正snapshot、Esc、非対話、解除/再入の既存テストを保持する。
- [ ] **Checkpoint:** 差分確認。コミットは別途許可された場合だけ行う。

## Task 2: 実CLIで個人設定とサンプルの分離を検証

**Files:** `scripts/test-startup-profile-cli.py`、必要なら `scripts/tests/test_cli_options.py`。

**Interfaces:**
- Acceptance fixtureに `self.profiles = self.home / '.pi/agent/profiles'` を持たせる。
- コピー済みの拡張サンプルは `self.extension/'profiles'` に残す。実効定義の編集・削除はself.profilesへ行う。
- 新規caseは `profile_home_separation` と `profile_root_override`。

- [ ] **RED:** home separationケースに、個人本文/スキルとサンプル本文/スキルを異なるmarkerにしたfixtureを追加する。self.envでHOME/PI_CODING_AGENT_DIRを合成先へ限定する。個人側で指定していないsample-only Profileと専用agentは一覧・model要求へ出ないことをassertする。
- [ ] **RED:** overrideケースに絶対root・~/root・invalid相対rootを用意し、既定HOME側と明示rootを異なるmarkerにする。invalidではOtherのみ、実HOMEへのfallbackや新規ファイル作成なしをassertする。
- [ ] **Run:** 両caseを実CLIで実行し、旧実装がサンプルを読んでしまうことによるFAILを記録する。fixture不備のFAILを製品REDと混同しない。
- [ ] **Implement fixture adaptation:** 現在の5 Profile＋空catalogを個人fixtureへコピーし、既存の定義変更/削除テストをself.profilesに切り替える。package_manifestテストは拡張パッケージ経由でHOMEを読めることを引き続き確認する。
- [ ] **GREEN:** 個人側を編集してreload、新しい会話、保存会話resume/fork/cloneを確認。サンプルの編集では個人設定が変わらないことを、現在のsystem prompt/skill展開で確認する。過去会話に残るmarkerを現在の広告と誤認しない。
- [ ] **Verify:** Pi 1.0.4と1.0.2で全CLI suiteを実行する。既存pi-subagentsとPlan/ompパスを明示し、未実行をskipで隠さない。

```sh
npm test
npm run typecheck
python3 -m unittest discover -s scripts/tests -v
python3 scripts/test-startup-profile-cli.py --case profile_home_separation
python3 scripts/test-startup-profile-cli.py --case profile_root_override
python3 scripts/test-startup-profile-cli.py \
  --subagents-extension /Users/papillon/.pi/agent/npm/node_modules/pi-subagents/index.js \
  --plan-extension /Users/papillon/Documents/Github/pi-plan-mode/plan-mode.ts \
  --omp-extension /Users/papillon/.my-pi/extensions/omp-modes.ts
```

- [ ] 最小版の--piには、既存extraction worktreeのPi 1.0.2 CLIパスを指定して同じ全suiteを実行する。他worktreeの依存や設定は変更しない。
- [ ] **Checkpoint:** 失敗・skip件数、モデル要求・PTY evidence、auth/models/settingsの非変更を確認する。

## Task 3: 説明・レビューと実ホーム初期配置

**Files:** README.md、docs/startup-profiles.md。ホーム側新規ファイルは許可後だけ。

- [ ] **Document:** 普段の編集先を `~/.pi/agent/profiles/` とし、リポジトリはコード/サンプルであることを記載する。PI_PROFILE_DIRの例、3認証アカウントの既定共通、初期化が自動でないこと、削除した個人Profileの復活なし、保存会話本文固定を説明する。
- [ ] **Verify:** 全単体・型・Python・CLIの実出力と `git diff --check` を確認。新規ファイルを含む差分を読む。
- [ ] **Review:** 承認された方法でレビューを行う。独立レビューが許可されていなければサブエージェントを勝手に起動しない。重要指摘は再現RED→GREENで修正する。
- [ ] **Approval barrier:** コードの稼働元へ反映する前に、コミット/main統合の対象・内容を示して許可を得る。ホーム配置も対象と影響を示して許可を得る。順序は、配置先の事前検査→上書きなし初期配置→検証済みコードの反映とする。
- [ ] **Preflight real destination:** `.pi/agent/profiles` が存在しないことをlstat相当で確認する。既存symlink（リンク切れも含む）やファイル/フォルダがあれば停止し、独断で変更しない。コピー元5 Profileのファイル一覧を再確認する。
- [ ] **Copy once:** 非存在のdestinationを排他的に作成し、profile.json×5、instructions.md×4、空catalog.json×1を新規作成する。write/コピー前に各ターゲットの非存在を確認し、競合があれば停止する。ファイルの内容bytesを変えない。sourceの旧平置きMarkdownやsecretary.md、コード、履歴、node_modulesはコピーしない。
- [ ] **Verify real files:** 10ファイルの相対パスとSHA-256をsourceと照合する。ローカルloadProfilesのID・表示順と専用保存先を確認する。実モデルAPIを検証目的で呼ばない。
- [ ] **Report:** 編集先・変更ID・検証結果・残る制限を提示する。稼働Piへはユーザーによるreload/restartが必要。push/公開・worktree削除は行わない。

## Completion Boundary

worktreeのコード検証と、実ホーム配置・ローカルmainへの反映を分けて管理する。今回の計画保存許可は文書のみ。自動初期化CLIの新設、Gitパッケージ導入、既存Profileの上書き、共有設定変更は、本計画を根拠に行わない。
