import os
import feedparser
import requests
from google import genai
from google.genai import types

# ==========================================
# 1. 初期設定 ＆ 安全なキー読み込み
# ==========================================
# 環境変数から安全に取得するよ。ターミナルで事前に set / export してね！✨
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY")

if not GEMINI_API_KEY:
    print("❌ エラー: 環境変数 'GEMINI_API_KEY' が設定されてないよ！🥺")
    print("ターミナルで設定してから実行してね。")
    exit(1)

# 凄腕トレーダーが注目するRSSフィードのリスト
RSS_URLS = [
    "https://www.marketwatch.com/rss/topstories",  # MarketWatch主要ニュース（英語）
    "https://www.reutersagency.com/feed/",          # ロイター世界速報（英語）
]

# ==========================================
# 2. 外部データの自動取得関数
# ==========================================
def fetch_latest_news(urls):
    combined_news = ""
    print("🔄 凄腕トレーダー注目のニュースサイトからデータを自動取得中...")
    for url in urls:
        try:
            feed = feedparser.parse(url)
            for entry in feed.entries[:5]:
                combined_news += f"■ Title: {entry.title}\nSummary: {entry.description}\n\n"
        except Exception as e:
            print(f"⚠️ フィードの取得に失敗したじゃん...: {url} (Error: {e})")
    return combined_news

def fetch_sns_dummy_data():
    """
    【将来のX（Twitter）API連携用スペース】
    プロトタイプとして、Geminiに推論させるためのトレーダーの声をシミュレートして返すよ！
    """
    print("📱 X（SNS）からトレーダーたちのリアルタイムな感情データを収集中...")
    sns_posts = """
    [Trader_A]: Nasdaq壊滅でワロタ。追証回避の強制決済ラッシュくるか？一旦全部キャッシュ（ドル）に戻すわ。
    [Trader_B]: ゴールド15分足でめっちゃリバってきた！やっぱり有事の金、株暴落時は鉄板の逃避先だな。
    [Trader_C]: ドル円リバ薄すぎ。145円割れたらパニック売り加速しそう。どこまで掘るんだこれ。
    [Trader_D]: 完全にリスクオフ相場。株投げてゴールドとドル握りしめるゲーム開始。
    """
    return sns_posts

# ==========================================
# 3. メイン処理：マクロと感情、データ数を掛け合わせて推論
# ==========================================
def main():
    # 各種エージェントデータの取得
    news_data = fetch_latest_news(RSS_URLS)
    sns_data = fetch_sns_dummy_data()
    
    # ニュースの件数と、SNSの行数（件数）をプログラム側で自動カウント！💅
    news_count = len(news_data.strip().split("■ Title:")) - 1 if "■ Title:" in news_data else 0
    sns_count = len([line for line in sns_data.strip().split("\n") if line.strip()])
    
    # データ件数のメタ情報をインプットの先頭にドッキング！
    input_content = f"""
    【本日のデータ収集実績（メタ情報）】
    ・マクロ経済ニュース取得件数: {news_count} 件
    ・SNS（X）サンプルポスト取得件数: {sns_count} 件
    
    【マクロ経済ニュース・指標データ】
    {news_data}
    
    【SNS（X）個人トレーダーのセンチメントデータ】
    {sns_data}
    """

    # プロンプト（システム指示）に信頼度評価ルールを追加！
    system_instruction = f"""
    # 役割
    あなたは金融市場（特にUSD/JPY、およびGold/USD）のファンダメンタルズ分析に特化した、超一流のチーフ・マクロストラテジスト（AIエージェント）です。
    ユーザーから提供される当日の「経済ニュース」と「SNSの市場の反応」を多角的に分析・推論し、翌日の相場にどのような影響を与えるかをジャッジしてください。

    # 分析・推論のルール
    1. 【マクロとセンチメントの融合】：
       事実ベースの経済ニュース（ロジック）と、SNSから読み取れるトレーダーの感情（心理）の両面から相場環境を推論してください。
    2. 【相関関係の考慮】：
       株安局面でのドルの流動性需要、米長期金利低下に伴うゴールドへの資金逃避など、各資産の相関関係に矛盾がないようにしてください。
    3. 【群衆心理の逆張り視点】：
       SNSで大衆があまりにも極端なパニック（総悲観・総強気）に陥っている場合、そこが短期的な反転ポイントになる可能性も考慮してください。
    4. 【信頼度の動的ジャッジ】：
       提供された「データ収集実績（件数）」を必ず確認してください。データ数が極端に少ない場合（例: ニュース3件未満、SNS5件未満など）は、市場の関心が薄いか情報不足であるため、推論の信頼度を「低」とし、慎重なトレードを促す警告を出力してください。

    # 出力フォーマット
    分析結果は、後続の「戦略エージェント」が読み込みやすいよう、必ず以下の構成で出力してください。
    ---
    ## 0. 本日の分析信頼度レポート
    - 【全体信頼度】：[高 / 中 / 低]
    - 【判断の根拠】：（取得できたニュースとSNSのデータ量に基づき、この推論結果の妥当性をAIの視点でロジカルに記述）

    ## 1. 本日の市場主要テーマ
    （現在、市場が最も注目している材料を1〜2行で記述）

    ## 2. ドル（USD）の方向性推論
    - 【推論ステータス】：[強気 / 弱気 / 中立]
    - 【推論の理由】：（ニュースとSNSの双方から推論した結果を記述）

    ## 3. ゴールド（Gold）の方向性推論
    - 【推論ステータス】：[強気 / 弱気 / 中立]
    - 【推論の理由】：（金利、ドル、投資家心理から推論した結果を記述）

    ## 4. SNSセンチメント分析
    - 【市場の心理状態】：[総強気 / 楽観 / 中立 / 悲観 / 総悲観]
    - 【個人トレーダーの動向】：（SNSデータから読み取れるポジションの偏りや、パニック度合いを推論）
    ---
    """

    print("🧠 Gemini 3.5 Flashを呼び出して、データ量を含めた統合推論を実行中...")
    
    client = genai.Client(api_key=GEMINI_API_KEY)
    
    # サトシが見つけてくれた正しいモデル名「gemini-3.5-flash」で実行！✨
    response = client.models.generate_content(
        model="gemini-3.5-flash", 
        contents=f"提供されたデータを分析し、データ量に基づく信頼度を含めて翌日の戦略のベースとなる推論を行ってください。\n\n{input_content}",
        config=types.GenerateContentConfig(
            system_instruction=system_instruction,
            temperature=0.2
        )
    )

    print("\n✨ 【AIエージェント①によるファンダメンタル＆SNS統合推論結果】 ✨")
    print(response.text)

if __name__ == "__main__":
    main()