# 起動時の用途別profile

新しい対話会話を開始すると、次の順に選べます。`/new` でも選び直せます。EscならOtherです。同じ会話の途中では変更しません。

1. Research: 情報やデータを調べ、出典付きのMarkdown・比較表・一覧などにまとめる（`research.md`）。
2. Specification: 要件・制約・受け入れ条件を整理し、仕様書にまとめる（`specification.md`）。
3. Development: コード・設計・検証の支援（`developer.md`）。
4. Chore（雑務）: 整理・定型作業・文案作成などの雑務を支援（`chore.md`）。
5. Other: 用途別指示なし。内部IDは互換性のため `standard` のままです。

Secretaryは新規選択肢から外しました。`secretary.md` は残しており、既存会話の保存済み指示は変更しません。

認証アカウント、モデル、思考レベル、スキル、ツール、MCPは変えません。共通安全ルールとプロジェクト指示は維持します。認証を切り替える既存のランチャーとは独立した機能です。

## 会話の再開

会話に選択した指示本文を固定して保存します。再開・reloadでは選択画面を出さず、その本文を復元します。fork/cloneも継承します。定義ファイルを変更・削除しても既存会話には反映されません。導入前の会話はOtherで開きます。

選択直後はPiの会話内メモリに登録され、初回ユーザーメッセージと一緒に会話ファイルへ保存されます。何も送信せず終了した場合、会話ファイルは作られず、次の新規起動で再び選びます。`--no-session` は終了後に復元できません。

print / JSON / RPCの新規会話はOtherで、選択待ちをしません。保存済み会話の再開ではその会話の指示を復元します。

## Profileの追加

`extensions/startup-profile/profiles/catalog.json` に次のような項目を追加し、同じディレクトリへ本文Markdownを置きます。
一覧はcatalogの記載順に表示します。Otherの項目が欠けている・不正な場合も、追加指示なしのOtherを末尾に補います。

```json
{"id":"writing","label":"執筆","description":"文章の構成と編集を支援","instructionsFile":"writing.md"}
```

IDは小文字英数字とハイフンで一意にします。OtherのID `standard` に指示ファイルは付けられません。Markdownはcatalogディレクトリ内に置きます。外部パス・親ディレクトリ遡り・外部へ出るsymlinkは拒否します。読み込めないprofileは警告して除外し、catalog全体が壊れた場合はOtherだけを表示します。

本文は新しい会話にのみ適用します。共通ルールを緩める指示や、秘密情報・パスワード・APIキーを入れないでください。保存本文は会話ファイルに含まれ、export/shareで公開される可能性があります。

## 制限

- 起動引数でのprofile指定、途中切り替え、profileごとの認証/モデル/ツール制限は実装しません。
- 壊れた保存状態や未知の状態バージョンは警告し、共通指示だけのOtherで開きます。元の状態は書き換えません。
- 任意の第三者拡張が後からsystem prompt全体を捨てる場合まで保証するものではありません。既知のPlanモード・omp-modesとの併用は合成環境で検証します。

## 開発時の検証

Pi 1.0.2 / Node 26.10.0で検証。初版のNode要件は26.10.0以上です。他のPi・Node版は未検証です。新しい実行時依存はありません。

```sh
npm ci --ignore-scripts
npm test
npm run typecheck
python3 -m unittest discover -s scripts/tests -v
python3 scripts/test-startup-profile-cli.py --pi "$(command -v pi)"
```

基本検証はmy-piなしで実行できます。外部拡張との互換ケース1件は明示的にskipされます。互換検証は別途、既存の両拡張パスを指定します。

```sh
python3 scripts/test-startup-profile-cli.py --pi "$(command -v pi)" \
  --compatibility-only \
  --plan-extension /path/to/pi-plan-mode/plan-mode.ts \
  --omp-extension /path/to/my-pi/extensions/omp-modes.ts
```

CLI検証は架空のHOME・設定・認証とlocalhostの架空モデルを使用し、外部APIを呼びません。PTY記録とモデル要求はignoredの `.test-evidence/cli/` に保存します。`--without-extension --case startup_select` は選択画面がない場合を見逃さない負例で、失敗が正常です。PTY検証はmacOS/Linux向けです。

導入は `pi install git:github.com/Papillon6814/pi-profile`。既存my-piのProfile実装と同時に有効化しないでください。元の登録を除外してから新パッケージを登録します。稼働設定への反映は隔離検証と承認後に行い、worktreeの検証だけでは既存環境を変更しません。
