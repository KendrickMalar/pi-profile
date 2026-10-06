# Profileフォルダと追加リソースの設計

## 目的

1 Profileを1フォルダで管理し、選択したProfileの指示・スキル・サブエージェントを、既存の共通設定に追加する。共通設定へのコピーやsettings.jsonの自動変更は行わない。

## 承認済みの方針

- 共通のスキル・エージェントは維持する。
- 指示本文は従来どおり会話に固定保存する。
- Profile固有のスキル・エージェントは再開・reload時に現在のファイルから読み直す。
- 本設計は初版の機能範囲を定める。コード実装、依存インストール、稼働設定への反映、コミット・公開は別途承認が必要。

## フォルダ構成

```text
extensions/startup-profile/profiles/
  research/
    profile.json
    instructions.md
    skills/
      source-check/SKILL.md
    agents/
      investigator.md
  specification/
  development/
  chore/
  standard/
```

profile.jsonの例:

```json
{"id":"research","label":"Research","description":"情報を調べ、出典付きの資料にまとめる","order":10,"enabled":true}
```

- profiles直下のフォルダを探索し、profile.jsonのあるものだけを候補とする。
- 必須項目はid、label、description。orderは省略時100、enabledは省略時true。
- idは既存形式と同じ小文字英数字・ハイフン。フォルダ名とidの一致は要求しない。登録・会話復元の識別子はidであり、フォルダ名ではない。
- orderは有限の整数。新形式はorder昇順、同順位はidの文字コード順に表示する。
- standard以外はinstructions.mdを必須とする。standardは追加指示なしで、instructions.mdは認めない。
- skills/とagents/は任意。ファイル編集後は/new、新規起動、またはreloadで再読込する。
- 無効化はenabled:falseで行う。削除はフォルダを外すことで可能だが、自動削除コマンドは追加しない。
- Other（id standard）は欠落・無効・不正でも、追加機能なしの既定値として補完する。新形式で有効なstandardは、指示なしのまま独自skills/agents/を持てる。
- label/descriptionの制御文字、不正なJSON、Profileごとの重複IDは診断対象とする。重複した新形式IDは両方を候補から除外し、恣意的に片方を採用しない。

## 旧形式との互換性

- catalog.jsonと旧Markdown形式は引き続き読み込む。
- 有効な新形式と旧形式のIDが同じなら新形式を優先し、警告する。
- 新形式のenabled:falseは同IDの旧形式にも優先し、旧定義へ戻って有効化しない。不正・重複した新形式IDも同IDの旧形式へ黙ってフォールバックしない。
- 新形式を先に並べ、重複しない旧形式をcatalog順で後ろに追加する。新形式がない場合は旧順序を保持する。
- 既存のProfileを新フォルダに移す際も、内部ID research/specification/developer/chore/standardを保持する。DevelopmentのIDをdevelopmentへ変更しない。
- 会話のversion:1スナップショットを引き続き復元する。指示本文を現在のファイルで置き換えない。

## 読み込みと会話の寿命

1. session_startで会話のProfileを選択または復元する。
2. 現在のフォルダ定義をIDで検索し、有効なProfileの追加リソースを解決する。
3. スキルはPiのresources_discoverで追加の読み込み先を返す。
4. エージェントはpi-subagents:runtime-agent-register:v1で登録し、返されたdisposeを保持する。
5. session_shutdownと再登録前に、自分が所有する登録だけを解除する。

/new・resume・fork・clone・reloadで旧Profileのリソースを持ち越さない。Profile指示はfork/cloneへ継承し、追加リソースは継承したIDに対応する現在の定義から読み込む。print/JSON/RPCでの新規会話は従来どおりOther、保存済み会話は保存IDを使う。

削除・無効・不正なProfileで既存会話を開いた場合、保存済み指示は復元するが、Profile追加リソースは読み込まず診断する。旧形式のみのProfileは従来どおり指示のみを提供する。

読み込んだリソースは、その会話の選択Profileのものである。モデルに渡したスキル本文や過去の会話内容の消去・権限隔離を保証するものではない。ファイルを編集すると既に読み込んだスキルの参照先・スクリプト内容は変わり得るため、追加リソースの完全固定を約束しない。

## スキル

- PiのAgent Skills形式を使う。Profileフォルダのskills/配下にSKILL.mdと任意の参照資料・スクリプトを置く。
- 名前・説明の広告、/skill:name、本文読込はPiの通常の機能を利用する。独自の疑似スキル登録で代用しない。
- 通常のグローバル・プロジェクト共通スキルはProfileより優先する。他拡張がresources_discoverで追加するスキルとの同名は、Piの拡張読み込み順に従う（ユーザー承認済み）。どの順序でも子の明示選択パスはマージ後の親の採用結果に一致させる。Profile内の重複も診断する。
- Agent Skillsの文書は命令としての利用を想定しているが、追加されたことだけを実行・送信・削除等の許可と扱わない。

## サブエージェント

agents/*.mdのMarkdown本文を子のsystemPromptに使い、先頭の設定欄を解析する。初版で認める項目はname、description、tools、skills、model、thinking、systemPromptMode、inheritProjectContext、inheritGlobalContext、inheritSkills。name/description/本文は必須。未知の項目や不正な型は診断してその定義を登録しない。

- nameは小文字英数字・ハイフン。登録名はprofile.<Profile ID>.<name>。
- tools/skillsは文字列配列またはカンマ区切り文字列。空配列と省略を区別する。tools省略はpi-subagentsの通常ツール設定を使い、空配列はツールなし。
- systemPromptModeの既定値はappend。inheritProjectContext、inheritGlobalContextは既定値true。inheritSkillsの既定値はfalse。既存の共通安全指示を取り除くことをProfile機能の目的としない。
- 使用スキルはskillsで明示選択できる。マージ後の親のスキル一覧から選択ファイルを解決し、SKILL.mdの個別絶対パスをskillPathへ渡す。子ではフォルダ名/ファイル名で解決するため、選択名と一致しない場合は診断してエージェントを除外する。単にProfileのskills/全体を渡してローカル優先にしない。
- model省略時はpi-subagentsの運用設定に従う。子のmodel指定を親モデルの切り替えと混同しない。
- 名前の自動別名は作らない。共通側ではprofile.で始まる完全名を使わない運用とし、通常の同名上書きは行わない。意図的に同じ完全名を共通側へ作った場合の衝突耐性は初版では保証しない。登録APIが検出する重複は通知して除外するが、共通のdiscovery時に検出される完全名衝突まで安全に回復すると約束しない。pi-subagents本体は改修しない。
- 子へ親Profileの指示本文を自動注入しない。子には自身のエージェント本文と選択したスキルを渡す。
- 親プロセスの登録であり、子へProfile全エージェントを自動登録することや、入れ子の委任は初版の対象外。
- pi-subagents未導入・非対応のときはエージェント機能だけ利用不可と通知し、Profile指示とスキルは使える。導入・更新を自動実行しない。
- 任意の拡張コード・外部runner・MCP・権限変更をProfileから登録する機能は初版に含めない。

## 安全性とエラー

- Profileの指示・登録用定義・発見対象はprofiles配下に限定する。親ディレクトリ遡りと外部へ出るsymlinkを拒否する。
- スキルはスクリプト等を含む信頼済みローカルコンテンツであり、実行のサンドボックスではない。発見パス検証によってスクリプト自身の外部アクセスまで封じるとは主張しない。
- 個別の壊れたスキル/エージェントは診断して除外し、共通機能と他の有効な定義を保つ。
- 共通AGENTS.md、Plan制限、認証、モデル、ツール、MCP、OS権限を親のProfile選択で変更しない。
- 全Profileのskillsをパッケージのpi.skillsへ一括登録しない。未選択のProfileも常時読み込まれるため。

## 変更単位

- catalog.ts: 新旧定義の統合とProfileメタデータ。
- 新しいfolder-profile.ts: フォルダ探索と定義検証。
- 新しいprofile-resources.ts: スキル候補とエージェント定義の解決。
- 新しいsubagent-registration.ts: 公開イベント登録・解除・非対応の診断。
- index.ts: Profile決定とリソース寿命の接続。
- state.ts: 保存済み本文の互換性維持。変更が不要なら触らない。
- profiles/: 既存Profileの新形式への移行。
- tests/startup-profile/、scripts/の実CLIテスト、README.md、docs/startup-profiles.md: 検証と使用手順。

## 受け入れ条件

- フォルダ作成・編集・enabled:falseで追加、編集、無効化できる。
- 共通＋選択ProfileのみがPiの通常スキル機能とsubagent呼び出しで利用できる。
- 新規→別Profileの/new、保存会話の切替、reload、fork/cloneにより旧登録が漏れたり重複したりしない。
- Profileスキルの/skill:nameとProfileエージェントの実起動を、架空データ・loopbackモデルで確認する。単なるプロンプト内の名前表示だけを成功としない。
- 共通と同名、重複ID、不正設定、パス逸脱、Profile削除・無効化、pi-subagentsなしを負例として検証する。
- 子の共通スキルとProfileスキル選択を前景・背景の両方で確認し、別Profileが混入しない。
- 保存済みversion:1の指示、Esc/非対話のOther、Plan共存を保持する。
- 実HOME・実認証・共有設定を変更せず、合成HOMEと架空認証を使う。
- 単体テスト、型チェック、Pythonテスト、実CLIテストの実出力を確認してから完了を判断する。

## 対応バージョンと実装前の確認

調査した実環境はPi 1.0.4、pi-subagents 0.76.1、既存プロジェクトの型依存はPi 1.0.2、Nodeの既存下限は26.10.0。公開イベント契約を機能検出し、未対応を通知する。

対応下限は既存のPi 1.0.2 / Node 26.10.0を維持し、Pi 1.0.2と1.0.4を実CLI検証対象とする。両版の実ソースで/newのruntime再構築とsession_start後のresources_discoverを確認した。resources追加自体は累積型であるため、reload時のリセットとruntime交換による解除を実CLIで検証する。既存下限で保証を満たせない場合は対応下限を黙って変更せず、ユーザーへ相談する。

ユーザーは①の専用名前方式を採用した。改修はpi-profileのみ。pi-subagentsは既存の公開イベント契約を利用し、通常のエージェント優先順位への統合、既存共通定義の差し替え、完全名が意図的に重複した場合の自動復旧は対象外とする。
