# pi-profile 起動前ランチャーとプロファイル別パッケージ管理 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** pi-kuno/pi-muu/pi-rbxから起動前に用途Profileを選び、通常Pi CLIと標準パッケージ解決を維持して専用パッケージを読み込む。

**Architecture:** pi-profileにコンパイル済みNode CLIを追加する。保存会話を読み取り専用で判定し、個人Profileのsource宣言を公開PackageManagerで解決した後、起動情報を既存拡張に渡して通常Piを子プロセスとして起動する。dotfilesのpi-accountは認証準備と既存補修を維持し、最終起動先だけ新CLIへ接続する。

**Tech Stack:** TypeScript 5.9 / Node >=26.10.0 / npm配置のPi 1.0.4 / Node test runner / Python unittest・PTY / bash。

**Spec:** `docs/superpowers/specs/2026-10-07-profile-package-launcher-design.md`（ユーザー承認済み）。実装用worktreeでは `docs/superpowers/specs/2026-10-07-profile-package-launcher-design.md` に保存する。

## Global Constraints

- 標準Pi CLIを利用し、Pi本体の改修・SDKによるPi UIの再実装は行わない。
- Profileはプロセス単位で固定。/newは同じProfileを継続し、異なるProfileの会話へ移るときは再起動する。
- 新規の対話起動では選択画面を出す。保存会話は保存済みProfileを自動復元する。
- Pi標準のパッケージ取得・依存解決挙動を維持する。--offlineや独自の一律自動導入禁止は追加しない。
- 既存認証、モデル、thinking、MCP、プロジェクト信頼、安全ルールを維持する。
- 初期対応はnpm配置のPi 1.0.4、Node 26.10.0以上、macOS/Linux。従来の拡張単体のPi 1.0.2互換は維持する。
- 通常のCLI起動環境の認証用PI_CODING_AGENT_DIRは変更しない。専用storeは ~/.pi/profile-packages/。
- 個人定義はPI_PROFILE_DIRまたは ~/.pi/agent/profiles。DevelopmentのIDはdeveloper。
- 宣言はpackages.jsonのversion:1とsource文字列配列。初期版にcache削除コマンドや個別resource-filter UIを含めない。
- 取得は標準PackageManagerへ委譲し、共通settings.jsonへ専用宣言を書き込まない。
- codeは今回専用のfeature worktreeで編集する。現在のai-secretary worktree、pi-profile/dotfilesの既存worktreeを流用しない。
- 実装実行の承認はGit commit/main統合/push/Issue変更/npm公開/実環境への導入を含まない。各Taskのcommitは別承認後に限る。
- テストは合成HOME/agentDir/XDG、架空認証、fake npm/Git、loopbackモデル。実アカウントや外部モデルを使わない。

## Review Focus

1. 新規起動と--continue/--resumeの途中で会話・Profile・宣言が変わる入力を取り違えず、コードロード前に対象を固定する（Task 3,4）。
2. 同Profileの親子セッションが起動情報を共有し、子が親のProfile選択・guard・秘密情報を誤継承しない（Task 1,4,6）。
3. sourceが共通/専用/別取得経路に重複し、同名ツールは1つでも複数factoryが実行されるケースを診断する（Task 2,4）。
4. reloadで取得やfactoryが失敗した場合、標準Piの扱いを維持し、構成宣言と実ロード成功を混同しない表示・再起動案内にする（reload後の一律強制停止は保証しない）（Task 1,4,6）。
5. 日本語・空白入りpath・piped stdin・--・秘密引数・SIGTERM/resizeが、argv/端末/所有一時ファイルの寿命を壊さない（Task 3,5,6）。

## 作業場所と開始時確認

実行承認後に以下を行う。計画作成時点ではまだ行わない。

- `git worktree add -b feat/2-profile-package-launcher ~/.config/superpowers/worktrees/pi-profile/profile-package-launcher main` をpi-profile repoで実行する。
- `git worktree add -b feat/pi-profile-launcher ~/.config/superpowers/worktrees/dotfiles/pi-profile-launcher main` をdotfiles repoで実行する。
- 同名path/branchが存在する場合は内容と作業目的を確認して停止し、上書き・削除・勝手な流用をしない。
- 各worktreeのbranch/top-level/common-dir/statusを確認する。ハーネスの編集先を今回のpi-profile worktreeへ切り替えてから最初の製品編集を行う。dotfilesの編集先も今回専用worktreeであることを確認する。
- pi-profile worktreeで `npm install --ignore-scripts` を実行し、`npm test` / `npm run typecheck` / `python3 -m unittest discover -s scripts/tests -v` をbaseline確認する。baseline失敗は報告し、勝手にskip・期待値変更・hook回避しない。
- Pi 1.0.4用CLIの型が必要な場合はdev peerを1.0.4に合わせる。ランタイムへ別Piをdependenciesとして同梱しない。Pi 1.0.2の旧拡張検証は別の合成配置で継続する。
- 承認済み設計書と本計画を新worktreeのdocs/superpowers/specs・plansへ保存する。以前の調査プローブを製品コードとして転用しない。

## File Structure

pi-profile repo:

```text
src/
  pi-host.ts                 対象Piの実体と公開SDK接続
  package-declarations.ts    packages.jsonの検証・更新
  package-resolver.ts        Profile専用標準PackageManager接続
  session-intent.ts          argvからsession/mode意図を抽出
  session-target.ts          会話探索と読み取り専用Profile復元
  launch-context.ts          起動情報schema・private IO・所有cleanup
  select-profile.ts          起動前Profile/会話selector
  launch.ts                  resolver/context/通常Pi spawn
  cli.ts                     launch/packagesサブコマンド
extensions/startup-profile/launch-bridge.ts
extensions/startup-profile/index.ts   既存拡張への条件付き接続
package.json / tsconfig.json / tsconfig.build.json
scripts/test-profile-launcher-cli.py
scripts/tests/test_launcher_cli_options.py
tests/launcher/*.test.ts
README.md / docs/startup-profiles.md / docs/profile-package-launcher.md
```

compiled binは `dist/src/cli.js`。packageのfilesに必要なdist、拡張が参照するsrc、既存extensions/docsを含める。binはNode用shebang付き。Pi本体や認証はtarballに含めない。

dotfiles repo:
- Modify `dot_local/bin/executable_pi-account`
- Create `tests/test_pi_account_launcher.py`（既存コードは触らず合成HOMEとfake executablesで実行）

## 共通インターフェース

新しいTypesは該当ファイルからexportする。隣のTaskで独自の同名typeを作らない。

```typescript
// package-declarations.ts
interface ProfilePackages { version: 1; packages: string[] }
// pi-host.ts
interface PiHost {
  executable: string; packageRoot: string; version: string;
  sdk: typeof import('@earendil-works/pi-coding-agent');
  readGlobalSettings(cwd: string, agentDir: string): ReturnType<import('@earendil-works/pi-coding-agent').SettingsManager['getGlobalSettings']>;
  createPackageManager(input: {cwd: string; store: string; packages: ProfilePackages; npmCommand?: string[]}): import('@earendil-works/pi-coding-agent').PackageManager;
}
// package-resolver.ts
interface ResolvedProfilePackages {
  profileId: string; sources: string[]; resourceRoots: string[];
  extensions: string[]; skills: string[]; prompts: string[]; themes: string[];
}
// session-intent.ts
interface SessionIntent {
  kind: 'new'|'continue'|'resume'|'session'|'session-id'|'fork'|'ephemeral'|'passthrough';
  mode: 'tui'|'print'|'json'|'rpc'; reference?: string; sessionDir?: string;
  originalArgs: string[];
}
// session-target.ts
interface SessionTarget {
  kind: 'new'|'resume'|'fork'|'ephemeral'; cwd: string; sessionPath?: string;
  sessionId?: string; sessionDigest?: string; savedProfile?: ProfileSnapshot; forwardedArgs: string[];
}
// launch-context.ts
interface LaunchContext {
  version: 1; profile: ProfileSnapshot; profileRoot?: string;
  packages: ResolvedProfilePackages; target: SessionTarget; ownerPid: number; nonce: string;
}
type ProfileChoice = {kind: 'selected'; id: string}|{kind: 'escape'}|{kind: 'cancel'};
type ProfileChooser = (items: ReadonlyArray<{id: string; label: string; description: string; packages: string[]}>) => Promise<ProfileChoice>;
type SessionChooser = (items: ReadonlyArray<{id: string; path: string; title: string; profileId: string}>) => Promise<string|null>;
```

ProfileSnapshot/ProfileDefinitionは既存state.ts/catalog.tsから再利用する。`PiHost`はpi-host.tsが公開するtarget executable・package root・公開SDK・標準PackageManager生成のadapter。LaunchContextのversion:1は既存指示snapshotのversion:1とは別schema。

### Task 1: 通常CLI連携の成立条件を先に検証する

**Files:** Create `tests/launcher/native-boundaries.test.ts`, `tests/launcher/fixtures.ts`; test用loopback/PTY基盤は既存scriptsの方式を読む。製品ファイルへ大規模な実装を先行させない。

**Interfaces:** Consumes承認済みspecと既存state/index。Produces通常CLI＋公開APIで満たせる境界の検証ログと、後続で用いる合成fixture。

- [ ] **Step 1:** `native_profile_package_root`, `reload_resolution_before_load`, `broken_profile_package_reload`, `child_does_not_consume_parent_context` の失敗するテストを作る。合成packageにimport/factory/start/shutdownのmarkerを持たせ、初回失敗時はモデル要求0、reload失敗後は標準Piが会話を継続するケースを別々にassertする。ユーザーはreloadも標準挙動に合わせる方針を選択済みで、強制停止の保証は追加しない。
- [ ] **Step 2:** `node --experimental-strip-types --test tests/launcher/native-boundaries.test.ts` で未実装の境界が失敗することを確認する。
- [ ] **Step 3:** fixture内だけの最小接続で、標準CLIへの `-e <導入済みpackage root>` が4 resource種類とpackage root provenanceを保つこと、reload時の公開イベントと標準resolverの接続、親子contextを区別できることを調べる。内部private API呼出し、monkey patch、Pi本体/UI再実装で通さない。
- [ ] **Step 4:** 同じテストを実行しログを保存する。通常CLIが初回load errorでexit 1になることと、reload時の扱いを別々に記録する。
- [ ] **Step 5:** 公開APIだけでspecを満たせない境界があればここで停止し、失敗証拠と必要な仕様変更を提示する。新しい方式の承認前にTask 2へ進まない。

### Task 2: 宣言・標準resolver・管理CLIのコア

**Files:** Create `src/pi-host.ts`, `src/package-declarations.ts`, `src/package-resolver.ts`, `tests/launcher/package-declarations.test.ts`, `tests/launcher/package-resolver.test.ts`, `tests/launcher/pi-host.test.ts`。

**Interfaces:**
- `loadProfilePackages(profileDirectory: string): ProfilePackages`
- `changeProfilePackages(profileDirectory: string, operation: 'add'|'remove', source: string, replace: boolean): Promise<ProfilePackages>`
- `resolveProfilePackages(host: PiHost, profileId: string, packages: ProfilePackages, home: string): Promise<ResolvedProfilePackages>`
- `manageProfilePackages(host: PiHost, profileId: string, packages: ProfilePackages, home: string, operation: 'install'|'update', source?: string): Promise<void>`
- `loadPiHost(executable: string): Promise<PiHost>`（公開entrypointとversionの確認。auth/model runtimeは生成しない）

- [ ] **Step 1:** testsにmissing=>空、unknown/duplicate keys・配列以外拒否、decl symlink escape拒否、相対local正規化、add重複/replace/remove、変更競合、fake npm/Git取得、固定/未固定、global同identity衝突、非対応Pi配置、peer非同梱をassertする。
- [ ] **Step 2:** `node --experimental-strip-types --test tests/launcher/package-*.test.ts tests/launcher/pi-host.test.ts` を実行して赤を確認する。
- [ ] **Step 3:** 3コアファイルの公開関数を実装する。source解釈/取得/updateを標準PackageManagerへ委譲し、宣言だけ安全に更新する。source集合は起動時にcaptureする。package rootを優先して標準CLIへ渡せる形を返し、bare extension fileの場合はfileを返す。
- [ ] **Step 4:** 同じtestsで緑を確認する。source storeだけに書き込み、auth・共通settings・Profile本文が変わらないことをassertする。取得失敗を空集合成功へ変換しない。
- [ ] **Step 5:** 別承認後にこの成果単位をcommitする。承認がなければworktreeに保全して次へ進む。

### Task 3: 読み取り専用の会話選択と起動情報

**Files:** Create `src/session-intent.ts`, `src/session-target.ts`, `src/launch-context.ts`, `src/select-profile.ts`, corresponding `tests/launcher/{session-intent,session-target,launch-context,selector}.test.ts`。

**Interfaces:**
- `parseSessionIntent(piArgs: string[], tty: {stdin: boolean; stdout: boolean}): SessionIntent`
- `resolveSessionTarget(host: PiHost, intent: SessionIntent, cwd: string, agentDir: string, chooseSession: SessionChooser): Promise<SessionTarget>`
- `selectStartupProfile(target: SessionTarget, profiles: ProfileDefinition[], explicitId: string|undefined, chooseProfile: ProfileChooser): Promise<ProfileSnapshot|null>`（null=Ctrl-C中止）
- `writeLaunchContext(context: LaunchContext, temporaryRoot: string): Promise<{path: string; dispose(): Promise<void>}>`
- `readLaunchContext(path: string): LaunchContext`

SessionChooser/ProfileChooserの入力はID付きitem配列、返却は選択ID、Escまたは中止。非対話では呼ばない。会話解析は公開parseSessionEntries/SessionManager探索と既存readSnapshotを使うが、openによるmigration/writeを起動前に実行しない。

- [ ] **Step 1:** testsでnew/continue/resume/session/session-id/fork/no-session、会話なしcontinue、曖昧なID、旧会話Other、不正snapshot拒否、CLI>env>project sessionDir>user sessionDir、cross-project cwd、known flag値に--sessionを含むargv、--後の文字列、piped stdin、明示IDと保存ID不一致、同表示名別IDをassertする。
- [ ] **Step 2:** `node --experimental-strip-types --test tests/launcher/session-*.test.ts tests/launcher/launch-context.test.ts tests/launcher/selector.test.ts` を実行して赤を確認する。
- [ ] **Step 3:** 4ファイルを実装する。新規TUIだけProfile選択、resumeは会話選択後に保存Profile復元、profileなし旧会話はOther。helperはstdoutへprotocol外文字を出さない。private contextはnonce/PID/形式/realpath/permissionを確認し、保存sourceを権限として扱わない。
- [ ] **Step 4:** 同じtestsで緑を確認する。context破損、stale PID、親のcontextを子へ流用、親directory symlink、cleanup対象すり替え、SIGINTとresize、日本語/空白入りpathを追加検証する。会話ファイル・Profile本文・認証が不変であることをassertする。
- [ ] **Step 5:** 別承認後にこの成果単位をcommitする。

### Task 4: 既存拡張へランチャー情報を接続する

**Files:** Create `extensions/startup-profile/launch-bridge.ts`, `tests/launcher/launch-bridge.test.ts`; Modify `extensions/startup-profile/index.ts` と必要な既存state/resource-lifecycle tests。

**Interfaces:** `attachLaunchBridge(pi: ExtensionAPI, context: LaunchContext): { profileForSession(event: SessionStartEvent, ctx: ExtensionContext): ProfileSnapshot; dispose(): void }`。legacy indexの通常起動挙動は変えず、環境変数 `PI_PROFILE_LAUNCH_CONTEXT` がある場合だけvalidate済みbridgeへ接続する。

- [ ] **Step 1:** 既存mock testsへ選択画面二重表示なし、/new固定、sameProfile resume、differentProfile before-switch cancel、reload標準解決、fork/clone/tree snapshot継承、child context非継承、失敗診断、legacy挙動不変をassertするテストを追加する。
- [ ] **Step 2:** `node --experimental-strip-types --test tests/startup-profile/*.test.ts tests/launcher/launch-bridge.test.ts` で赤を確認する。
- [ ] **Step 3:** 既存generation/sessionId/disposeの規則を保ってbridgeを接続する。Profile snapshotは既存version:1のまま。別customTypeにランチャー管理情報を保存し、file内source/pathを取得許可にしない。standard resolverを呼ぶreload境界とエラー扱いはTask 1で確認した公開契約だけを使う。
- [ ] **Step 4:** 同じtestsで緑を確認する。破損launch contextはlegacyへ黙ってfallbackしない。異なるProfileへの切替は旧runtime終了前にcancelされることをassertする。専用package roots/required入口の不整合を診断する。
- [ ] **Step 5:** 別承認後にこの成果単位をcommitする。

### Task 5: 通常Pi spawn・配布bin・pi-account接続

**Files:** Create `src/launch.ts`, `src/cli.ts`, `tsconfig.build.json`, `tests/launcher/{launch,cli,packaging}.test.ts`。Modify pi-profile `package.json`, `tsconfig.json`, `tests/package.test.ts`。dotfiles Modify `dot_local/bin/executable_pi-account`, Create `tests/test_pi_account_launcher.py`。

**Interfaces:**
- `launchPi(input: {host: PiHost; target: SessionTarget; profile: ProfileSnapshot; packages: ResolvedProfilePackages; env: NodeJS.ProcessEnv}): Promise<number>`
- `runCli(argv: string[], env: NodeJS.ProcessEnv): Promise<number>`
- bin=`dist/src/cli.js`; pi-account normal branch=`pi-profile launch -- "$@"`; explicit bypass `PI_PROFILE_LAUNCHER=0` preserves old exec pi path。

- [ ] **Step 1:** testsでargv完全保存、選択前prompt未送信、stdio inherit、--help/--version/非会話subcommand passthrough、終了status、SIGINT/SIGTERM forwarding、所有contextのみcleanup、ランチャー欠落時拒否、bypassをassertする。fake node/npm/Git/pi-profile/pi/patch commandsと合成HOMEを使う。
- [ ] **Step 2:** `node --experimental-strip-types --test tests/launcher/launch.test.ts tests/launcher/cli.test.ts tests/launcher/packaging.test.ts` およびdotfiles `python3 -m unittest discover -s tests -v` で赤を確認する。
- [ ] **Step 3:** CLIのlaunch/packages routingと通常Pi spawnを実装する。package scriptsにbuildを追加、tsconfig.buildはnoEmit=false/outDir=dist/rewriteRelativeImportExtensions=trueを使う。runtimeに別Piをbundleしない。pi-accountの3accountと既存補修順序を保持して最終execだけ接続する。
- [ ] **Step 4:** `npm run build`、同じtests、`npm pack --dry-run` を確認する。既存unit実行対象にtests/launcherを加える。tgzを合成prefixへ入れ、空白入りpathでもbinが動き、TS直接実行や欠落source参照がないことをassertする。global npm link/chezmoi applyは実行しない。
- [ ] **Step 5:** 別承認後、repo別にこの成果単位をcommitする。

### Task 6: 実CLIの受け入れ・互換性・手順書

**Files:** Create `scripts/test-profile-launcher-cli.py`, `scripts/tests/test_launcher_cli_options.py`, `docs/profile-package-launcher.md`; Modify `README.md`, `docs/startup-profiles.md`。baseline `scripts/test-startup-profile-cli.py` は従来suiteを維持し、fixtureへ新しいsrc/distをコピーする変更だけを必要に応じて追加する。

**Interfaces:** new harness flags `--pi PATH`, `--launcher PATH`, `--case NAME`, `--subagents-extension PATH`, `--plan-extension PATH`, `--omp-extension PATH`。明示された既存依存のみ使い、自動ダウンロードしない。Pi 1.0.2は確認済みの /Users/papillon/.config/superpowers/worktrees/pi-profile/profile-home-config/node_modules/.bin/pi を読み取り専用の依存として使い、同worktreeを編集・設定変更しない。

- [ ] **Step 1:** PTY/JSON/RPC/loopback/fake registry fixturesでspec §10の受け入れケースを失敗するテストとして用意する。新規選択1回、非対象package import/factory/tool/event無し、保存ID復元、/new固定、異Profile拒否、reload失敗、子agent、3account分離、trust拒否/承認、resize・piped stdin・signalsを含める。
- [ ] **Step 2:** 新harnessを実行して赤を確認する。既存harnessは--offlineを使うため、自動通信維持の証拠には流用しない。新harnessではlaunchがPI_OFFLINE/--offlineを追加しないケースと、loopbackモデル/captured refresh経路を分ける。外部networkの成功を必要とするテストにしない。
- [ ] **Step 3:** 先行Taskを受け入れケースに合わせて限定修正する。docsへ対応版、非対話/再開、新CLI、packages source、標準自動取得、bypass、起動経路、共有設定を変えない導入/復旧手順を記す。
- [ ] **Step 4:** 以下を実行して実出力を保全する。
  - pi-profile: `npm run build && npm test && npm run typecheck`
  - pi-profile: `python3 -m unittest discover -s scripts/tests -v`
  - pi-profile: `python3 scripts/test-startup-profile-cli.py --pi /opt/homebrew/bin/pi`
  - pi-profile: `python3 scripts/test-startup-profile-cli.py --pi /Users/papillon/.config/superpowers/worktrees/pi-profile/profile-home-config/node_modules/.bin/pi`（確認済み1.0.2をread-only依存として使用）
  - pi-profile: `python3 scripts/test-profile-launcher-cli.py --pi /opt/homebrew/bin/pi --launcher dist/src/cli.js`。互換性caseは承認された既存拡張pathを明示して実行。
  - dotfiles: `python3 -m unittest discover -s tests -v` と `bash -n dot_local/bin/executable_pi-account`
  - `npm pack --dry-run` とsynthetic tgz/bin試験
- [ ] **Step 5:** specの各受け入れ条件とtest/logを対応付ける。skip、非対応版、未実施の実アカウント/外部取得は明記する。差分を読み、別のreviewerに全branchを検査させる。問題の解消を再検証し、実環境反映を行わず結果を報告する。
- [ ] **Step 6:** commit/main統合/push、Issue更新、CLI登録、chezmoi反映、個人package割当は、成果と対象・影響を提示して別承認を得る。pi-ghの移管・公開はこのplanで実行しない。

## Self-Review

- Spec §1-4 => Task 2,5、§5-6 => Task 1,3,4,6、§7-8 => Task 1-6、§9-10 => setup/Task 5,6。
- Review Focus 5件は上記test stepへ割当済み。
- ProfileSnapshotは既存type、管理schemaとlaunchschemaは別。新interfaceの名称は共通インターフェース欄に固定。
- CLIの成立性とreload/子agent境界は未実装なのでTask 1を停止ゲートにする。15+35件の調査成功を製品の合格証明にしない。
- 認証/個人Profile/共通settings/他repoworktreeを保全する。Pi内部monkey patchや無断の--offlineで通さない。
- 既存Issue #1の空白入りcheckoutのunit test問題は別案件。baselineで遭遇したら報告し、無断で修正・skipしない。

## Execution Handoff

実装計画のレビューと実行方式選択を待つ。どちらの方式でも親が差分と検証出力を確認する。
- Native: 親がTaskを順に実装し、最後に独立reviewerが全branchを検査する。
- Subagent-driven: 各Taskを1 writerへ委任し、Taskごとの独立reviewを経て進む。repo/worktreeのwriterを重複させない。

本計画の推薦はNative。Task間で起動情報・認証保持・argv・resolver・既存拡張の境界を連続して確認する必要があり、頻繁な引き継ぎより一人の実装者が一貫して追う方が効率的。最終独立reviewは省略しない。
