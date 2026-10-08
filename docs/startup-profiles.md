# 起動時の用途別profile


## 起動前ランチャー経由の追加機能

`pi-profile launch` を使う場合だけ、Pi本体の起動前に用途を選び、専用パッケージを標準PackageManagerで解決します。保存会話は保存Profileを復元し、`/new` は起動時のProfileを継続します。別Profileへは再起動します。以下の従来のPi内選択の説明は、素の `pi` で拡張単体を使う経路に適用します。

専用宣言は個人Profile内のpackages.json、保存先は ~/.pi/profile-packages/<ID>/ です。未導入時の取得や依存解決、reloadの失敗扱いは標準Piに従い、--offlineは追加しません。認証用agentDirや共有settingsは切り替えません。詳細は [Profile package launcher](profile-package-launcher.md) を参照してください。稼働するpi-accountへの接続は別承認の導入作業です。

新しい対話会話を開始すると、次の順に選べます。`/new` でも選び直せます。EscならOtherです。同じ会話の途中では変更しません。

1. Research: 情報やデータを調べ、出典付きのMarkdown・比較表・一覧などにまとめる（`research.md`）。
2. Specification: 要件・制約・受け入れ条件を整理し、仕様書にまとめる（`specification.md`）。
3. Development: コード・設計・検証の支援（`developer.md`）。
4. Chore（雑務）: 整理・定型作業・文案作成などの雑務を支援（`chore.md`）。
5. Other: 用途別指示なし。内部IDは互換性のため `standard` のままです。

Secretaryは新規選択肢から外しました。`secretary.md` は残しており、既存会話の保存済み指示は変更しません。

認証アカウント、親モデル、思考レベル、ツール、MCPは変えません。共通のスキル・エージェントを維持し、選択Profileの追加スキル・専用名エージェントを会話に読み込みます。共通安全ルールとプロジェクト指示は維持します。認証ランチャーとは独立しています。

## 会話の再開

会話に選択した指示本文を固定して保存します。再開・reloadでは選択画面を出さず、その本文を復元します。fork/cloneも継承します。定義ファイルを変更・削除しても既存会話には反映されません。導入前の会話はOtherで開きます。
スキル・エージェントは指示本文とは別です。再開・reload時に現在のフォルダを読み直します。削除・無効化されたProfileの既存会話では、保存済み指示だけを復元して追加機能は読み込みません。参照スクリプトなどの完全固定や実行サンドボックスを保証しません。

選択直後はPiの会話内メモリに登録され、初回ユーザーメッセージと一緒に会話ファイルへ保存されます。何も送信せず終了した場合、会話ファイルは作られず、次の新規起動で再び選びます。`--no-session` は終了後に復元できません。

print / JSON / RPCの新規会話はOtherで、選択待ちをしません。保存済み会話の再開ではその会話の指示を復元します。

## Profileの追加

普段は **`~/.pi/agent/profiles/`** にProfileごとのフォルダを作り、編集します。リポジトリ内の `extensions/startup-profile/profiles/` はサンプルです。個人設定と混ぜて読み込まず、サンプルを編集しても普段のProfileには反映されません。

初期配置は一度だけ行います。保存先が未作成であることを確認し、5つのサンプルフォルダ（research/specification/development/chore/standard）をコピーしてください。空のcatalog.jsonはコピー不要です。既存ファイル・フォルダ・symlinkがある場合は上書きせず先に確認します。旧平置きMarkdownやsecretary.md、拡張コード、node_modulesはコピー不要です。

起動時の自動コピーや自動作成はしません。保存先がない・空ならOtherだけになります。個人Profileを消してもサンプルから復活しません。以後の編集はホーム側で行い、追加リソースは再開/reloadで読み直します。

保存先を変える場合:

```sh
PI_PROFILE_DIR="$HOME/my-profiles" pi
PI_PROFILE_DIR='~/my-profiles' pi
```

未設定・空文字は既定の `~/.pi/agent/profiles/`、非空は絶対パスまたは~/だけを受け付けます。不正な相対パス・制御文字・空白だけの値は警告してOtherとなり、別の保存先へフォールバックしません。PI_CODING_AGENT_DIRによる認証アカウント切替では既定Profile保存先を変えません。pi-kuno/pi-muu/pi-rbxも同じHOMEなら共通利用です。コードやサンプルの更新で個人ファイルを自動上書きしません。

```text
research/
  profile.json
  instructions.md
  skills/source-check/SKILL.md
  agents/investigator.md
```

```json
{"id":"research","label":"Research","description":"出典を確認して調査","order":10,"enabled":true}
```

表示順はorder（省略時100）、同順位はID順。enabled:falseで新規選択から外します。Other（id standard）はinstructions.mdを置かず、欠落・不正でも既定値として補完されます。DevelopmentのIDはdeveloperのままです。

スキルは通常のAgent Skills形式です。通常の共通スキルと同名なら共通を優先します。他拡張から追加された同名スキルはPiの読み込み順（先に発見した方）に従い、子の明示選択もマージ後の親と同じファイルに揃えます。親ではSKILL.mdのnameが使われますが、子で選択するスキルはフォルダ名（単独.mdならファイル名）もnameと一致させてください。不一致はエージェントの登録時に警告して除外します。

エージェントはagents直下にMarkdownで置きます。

```yaml
---
name: investigator
description: 出典の裏付けを確認
skills: source-check
tools: read, bash
---
出典を確認し、事実と推測を分ける。
```

呼び出し名は`profile.research.investigator`です。共通とProfileを同名で上書きせず、別担当として利用します。共通側でprofile.始まりの完全名・別名を使わないでください。意図的な完全名衝突の自動復旧は保証しません。

設定項目はname/description/tools/skills/model/thinking/systemPromptMode/inheritProjectContext/inheritGlobalContext/inheritSkillsと、pi-subagentsの項目extensions/defaultContext/async/acceptanceRole/allowNestedSubagents/allowedAgents/advertiseです。未知の項目は除外します。extensionsは絶対パスか~/のみ。allowedAgentsに同じProfileのエージェントを短い名前で書くと、登録名profile.<id>.<name>に読み替えます（実行時定義でallowedAgentsを受け付けるpi-subagentsが必要。未対応なら登録しません）。登録したエージェントは、advertise: false以外は親のプロンプトで紹介します。既定はappend、project/global指示の継承あり、全スキル継承なし。skillsで明示選択し、親が採用したスキルを子にも渡します。tools省略は通常設定、[]はツールなし。ツールの名前を書くだけではその拡張providerは読み込まれません。
toolsに `/` を含む値や `.ts` / `.js` のパスは指定できません。pi-subagentsが拡張コードとして読み込むため、Profile側で拒否します。

追加エージェントには対応するpi-subagentsが必要です（0.76.1で検証）。未導入・未対応なら警告し、指示・スキルはそのまま利用できます。子への全Profileエージェント登録、入れ子委任、外部runnerや拡張コードの自動導入は行いません。

既存catalog.json形式も利用可能ですが、ファイルは任意です。フォルダ形式だけなら不要で、空のcatalog.jsonは削除しても欠落による警告は出ません。不正JSON・読み取り不能・リンク先がないcatalogのsymlinkは引き続き警告します。新フォルダと同IDは新形式優先。無効化したIDが旧catalogで復活することはありません。外部へ出るsymlink・パス逸脱は拒否します。

本文は新しい会話にのみ適用します。共通ルールを緩める指示や、秘密情報・パスワード・APIキーを入れないでください。保存本文は会話ファイルに含まれ、export/shareで公開される可能性があります。

## 制限

- 起動引数でのprofile指定、途中切り替え、profileごとの認証/モデル/ツール制限は実装しません。
- 壊れた保存状態や未知の状態バージョンは警告し、共通指示だけのOtherで開きます。元の状態は書き換えません。
- 任意の第三者拡張が後からsystem prompt全体を捨てる場合まで保証するものではありません。既知のPlanモード・omp-modesとの併用は合成環境で検証します。

## 開発時の検証

Pi 1.0.2・1.0.4 / Node 26.10.0で検証。Node要件は26.10.0以上です。他のPi・Node版は未検証です。新しい実行時依存はありません。

```sh
npm ci --ignore-scripts
npm test
npm run typecheck
python3 -m unittest discover -s scripts/tests -v
python3 scripts/test-startup-profile-cli.py --pi "$(command -v pi)"
```

基本検証はmy-piなしで実行できます。Plan/omp互換1件とpi-subagents実起動3件（基本・共通拡張の前後順序）は、既存拡張パスを指定しない場合skipされます。pi-subagentsの基本検証は `--case profile_subagent_resources --subagents-extension /path/to/pi-subagents/index.js` です。全件実行には両互換拡張とsubagents拡張のパスを指定します。

```sh
python3 scripts/test-startup-profile-cli.py --pi "$(command -v pi)" \
  --compatibility-only \
  --plan-extension /path/to/pi-plan-mode/plan-mode.ts \
  --omp-extension /path/to/my-pi/extensions/omp-modes.ts
```

CLI検証は架空のHOME・設定・認証とlocalhostの架空モデルを使用し、外部APIを呼びません。PTY記録とモデル要求はignoredの `.test-evidence/cli/` に保存します。`--without-extension --case startup_select` は選択画面がない場合を見逃さない負例で、失敗が正常です。PTY検証はmacOS/Linux向けです。

導入は `pi install git:github.com/Papillon6814/pi-profile`。既存my-piのProfile実装と同時に有効化しないでください。元の登録を除外してから新パッケージを登録します。稼働設定への反映は隔離検証と承認後に行い、worktreeの検証だけでは既存環境を変更しません。
