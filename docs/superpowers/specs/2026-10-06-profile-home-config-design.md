# 個人Profileのホーム設定分離

## 目的と承認範囲

開発・配布用のpi-profileリポジトリと、普段編集する個人Profile定義を分離する。ユーザーが承認した設計は、ホーム側だけを既定で読み、既存5 Profileを上書きなしで初期コピーする方式。今回の文書保存許可は本仕様書の作成のみであり、コード実装・依存インストール・ホーム側配置・コミット・main統合・公開は含まない。

## 配置

```text
~/Documents/Github/pi-profile/
  extensions/startup-profile/       拡張の実装
  extensions/startup-profile/profiles/   配布用サンプル

~/.pi/agent/profiles/
  catalog.json                     旧形式互換用、初期値は空配列
  research/profile.json
  research/instructions.md
  specification/profile.json
  specification/instructions.md
  development/profile.json         内部IDはdeveloper
  development/instructions.md
  chore/profile.json
  chore/instructions.md
  standard/profile.json            instructions.mdなし
```

skills/・agents/は各個人Profileフォルダ内に置く。初期サンプルにないskills/・agents/を架空の業務定義で埋めない。リポジトリ側のサンプルと旧Markdownは保全し、実運用の読込元として混ぜない。

## 読み込み先

- 既定はos.homedir()を基準とする `.pi/agent/profiles`。
- `PI_PROFILE_DIR` が未設定または空文字なら既定値を使う。非空なら保存先を明示的に選ぶ。
- 許容する指定は絶対パスまたは `~/` 始まり。`~/` はホームへ展開する。相対パス、制御文字、空白だけの指定は不正とし、警告して追加指示なしOtherにする。別の保存先へ黙ってフォールバックしない。
- PI_CODING_AGENT_DIRによる認証アカウント切替と用途別Profile保存先を分ける。pi-kuno / pi-muu / pi-rbxは、PI_PROFILE_DIRを別途指定しない限り同じホームの `.pi/agent/profiles` を使う。
- 起動・new・resume・reload・fork/cloneのsession_start境界で保存先を解決する。選択後の会話中に勝手に別の保存先へ切り替えない。
- 明示したテスト用profilesRoot引数は既存のfixture injectionとして保持できるが、実運用の設定UIや新規CLIフラグにしない。
- 保存先がない・ファイルである・読み取り不能なら、Otherのみを提供し、読込先と初期配置が必要な旨を診断する。自動コピー・自動作成・自動ダウンロードはしない。
- 保存先が正常で空の場合もOtherのみ。個人がサンプルを消してもリポジトリ側の同IDから復活させない。
- 選択されたルート内での指示・スキル・エージェントのパス逸脱検証は既存実装を維持する。指定ルートの意図的なsymlinkは読込時にはcanonicalなルートとして扱う。これは任意のスクリプトをsandbox化する保証ではない。

## 初期配置

今回の初期配置は、実装と別に承認された外部ローカル変更として親が実施する。初期化コマンドや起動時の自動コピー機能は追加しない。

1. 実行直前に対象 `.pi/agent/profiles` と、コピー元の5 Profileの内容・ファイル一覧を再確認する。
2. 保存先が既に存在する場合は、空フォルダやsymlinkであっても独断でマージ・上書きしない。停止して内容を提示し、方針を確認する。
3. 保存先が存在しない場合に限り、5 Profileのprofile.jsonとinstructions.md、空catalog.jsonを新規作成する。sourceの本文bytesとID・表示順を保持する。旧平置きMarkdownやsecretary.mdは初期コピーしない。
4. 作成した各ファイルをコピー元と比較する。認証・models・MCP・共有settings.json・ランチャーには触れない。
5. 実ホームを使う確認はローカルのファイル一覧・内容一致・読込結果の確認まで。実モデルへ検証のためのAPI要求を送らない。実CLIの挙動試験は合成HOMEとloopbackモデルで行う。

初期配置後、サンプルの編集やリポジトリ更新は個人Profileへ自動反映されない。以後の追加・編集・無効化・削除はホーム側で行う。

## 既存会話と追加リソース

指示本文のversion:1会話snapshotは従来どおり固定。保存されたIDと名前・本文を書き換えない。追加スキル・エージェントは、再開・reload時にホーム側または明示ルートの同じIDから解決する。該当IDがない場合は保存済み指示だけを復元し、追加リソースを利用できない旨を通知する。

専用名 `profile.<id>.<name>`、他拡張スキルのPi読込順、親子の採用パス一致、tools拡張パス拒否、所有disposeとgeneration/sessionIdによる解除は維持する。PI_PROFILE_DIRの変更だけで親のモデル・認証・ツール・MCP・共通安全指示は変更しない。

## 変更単位

- 新規 `extensions/startup-profile/profile-root.ts`: 既定値・環境変数の純粋な解決と診断。
- `extensions/startup-profile/index.ts`: ルート解決をsession_startに接続し、欠落・不正時の安全なOtherと保存snapshot復元を提供。
- `tests/startup-profile/profile-root.test.ts`と既存extension/resource-lifecycleテスト: 保存先選択・隔離・互換性。
- `scripts/test-startup-profile-cli.py`: fixtureに個人profilesを配置して旧既存suiteを維持し、リポジトリと個人Profileを別々に編集して分離を確認。
- `README.md` / `docs/startup-profiles.md`: 実運用の編集先、環境変数、手動初期配置、サンプルとの分離を説明。
- 初期配置時だけ実ホーム側の5フォルダとcatalog.jsonを新規作成。

## 検証・受け入れ条件

- リポジトリサンプルと個人定義を異なるmarkerにし、モデル要求と/skill展開には選択した個人側だけが現れる。
- 個人側の編集を再開・reloadで読み直し、リポジトリ側の編集では個人定義が変わらない。
- サンプル側にしかないProfileやスキル・エージェントはロードしない。
- 既定値、絶対/~/指定、空文字、不正な相対パス、欠落、空保存先、ファイル保存先を検証する。不正時に実ホームへフォールバックして読み込まない。
- PI_CODING_AGENT_DIRが異なる3設定でも、同一HOMEなら既定Profileルートは同一である。
- 既存会話を、リポジトリ由来の古いID/本文snapshotで再開し、本文維持と個人側リソース読込を確認する。
- 既存の全単体・型・Python・実CLI suiteをPi 1.0.2と1.0.4で確認する。個人スキルと専用エージェントの前景/背景、他拡張の前後順、削除reload、Plan共存も維持する。
- 実CLI検証は合成HOME/agentDir/cwd/XDG・架空認証・loopbackモデル・明示拡張のみ。実HOMEや実認証をfixtureに流用しない。
- ホーム初期配置は実行直前の状態確認とファイル比較を証拠にする。既存ファイルの上書きなしを確認する。

## 対象外と反映境界

拡張本体のGitパッケージ導入、npm公開、共有設定・認証変更、サンプルファイルの削除、旧worktreeの削除は対象外。コードは新feature worktreeで作業し、稼働する登録元への反映（コミット/main統合）には別途承認を得る。ホーム側の初期コピーはコード承認と別に対象・範囲を示して許可を得る。
