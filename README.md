# Doodle Studio — فيديوهات Doodle احترافية، مجانًا وعلى جهازك

أداة تحوّل **سيناريو مكتوبًا** إلى **فيديو Doodle** (يد حقيقية مصوّرة ترسم رسومات كرتونية خطًا بخط على
سبورة بيضاء، ثم تتلوّن، مع تعليق صوتي). لا اشتراكات، لا علامة مائية. كل الكتل مفتوحة المصدر أو مجانية.

```
فكرة  →  (وكيل السيناريو)  →  script.json  +  رسومات  →  doodle render  →  video.mp4
```

## ما الذي تغيّر في النسخة الثانية (جودة Doodly)

| المحور | قبل | الآن |
|---|---|---|
| اليد | رسمة كرتونية | **يد حقيقية مصوّرة** بقلم ماركر أسود، الساعد يخرج من الإطار، ظل، ميل طبيعي مع اتجاه الخط، رفع القلم بين الضربات، دخول وخروج ناعم |
| الرسومات | أيقونات بسيطة | **أي صورة كرتونية أو لوجو أو صورة** تتحوّل داخل المحرّك إلى ضربات قلم مرتّبة كما يرسمها إنسان (هيكلة خطوط الوسط + ترتيب بالكائنات)، ثم تظهر الألوان الأصلية |
| المكتبات | 30 أيقونة | + 33 شخصية Open Doodles (CC0) + شخصيات Open Peeps بلا حدود (CC0) + 5,130 أيقونة Tabler (MIT) |
| الرسومات المخصّصة | — | وكيل السيناريو يكتب لك برومبت جاهزًا لكل رسمة ناقصة (`artRequests`)، تولّدها بأي أداة صور مجانية وتضعها في مجلد `art/` |
| الصوت | جملة واحدة متصلة | تقطيع بالجُمل مع وقفات طبيعية، صوت افتراضي أفضل (Shakir)، و**5 مزوّدات صوت** قابلة للتبديل بينها نماذج عربية مفتوحة بجودة قريبة من ElevenLabs |

## التثبيت (مرة واحدة)

1. ثبّت **Node.js 20+** من nodejs.org.
2. داخل مجلد الأداة:

```bash
npm install
npx playwright install chromium
```

(اختياري) لقصّ يدك أنت من صورة: `pip install "rembg[cpu,cli]"`.

## أول فيديو

```bash
node src/cli.mjs render examples/demo-ar.json -o output/demo.mp4        # كامل 1080p
node src/cli.mjs render examples/demo-ar.json --draft                   # معاينة سريعة
node src/cli.mjs still  examples/demo-ar.json --at 6 -o frame.png       # لقطة واحدة
```


## الواجهة (بدون سطر أوامر)

```bash
npm start          # يفتح http://localhost:7860
```

أربع خطوات في صفحة واحدة: **الفكرة** (اكتب فكرتك ← الوكيل يكتب السيناريو) ← **المشاهد** (عدّل النص والعناصر،
ارفع رسوماتك في `art/`، اختر اليد) ← **الصوت** (اختر المزوّد والصوت واسمع عيّنة) ← **المعاينة والتصيير**
(لقطة فورية، معاينة سريعة، تصيير نهائي 1080p مع شريط تقدّم وتحميل). المفاتيح تُحفظ في `workspace/.env` على جهازك.

## الاستضافة

| الخيار | يصلح؟ | لماذا |
|---|---|---|
| **جهازك** (`npm start`) | ✅ الأفضل | مجاني بالكامل، أسرع تصيير، ملفاتك عندك |
| **Hugging Face Spaces** (Docker، مجاني، 16GB RAM) | ✅ | يشغّل Chromium وffmpeg بلا قيود وقت: `python scripts/deploy-hf.py user/doodle-studio` مع `HF_TOKEN` |
| **أي VPS / Docker** | ✅ | `docker build -t doodle . && docker run -p 7860:7860 -v $PWD/workspace:/data/workspace doodle` |
| **Vercel / Netlify** | ❌ | دوال قصيرة العمر بلا Chromium/ffmpeg؛ تصيير فيديو دقيقة يحتاج دقائق من المعالجة المتصلة |

على Hugging Face أضف المفاتيح كأسرار (Settings → Variables and secrets): `GEMINI_API_KEY`، `DOODLE_TTS=gemini`.

## الرسومات: من أين تأتي؟

1. **صورك أنت** — `{"type":"image","src":"art/x.png"}`. أي PNG/JPG/SVG: رسمة كرتونية، لوجو، أو حتى صورة فوتوغرافية.
   المحرّك يستخرج خطوط الوسط ويرسمها بالقلم ثم يُظهر الألوان. الخلفية البيضاء تُزال تلقائيًا.
   - `"mode":"reveal"` تكشف الصورة الحقيقية تحت اليد بدل رسمها (مناسب للصور الفوتوغرافية).
   - `"style":"line"` يُبقيها أبيض وأسود بلا تلوين. `"threshold": 150` لضبط حساسية الحبر.
2. **توليد رسومات جديدة مجانًا** — أي أداة صور مجانية (Microsoft Designer / Copilot، تطبيق Gemini، Leonardo…)
   بهذا البرومبت، ثم احفظ الصورة في `art/`:
   > Whiteboard explainer video illustration, hand-drawn doodle style like Doodly: **[صف المشهد]**. Thick uniform black marker
   > outlines, clean continuous lines, minimal flat color only on **[عنصر واحد]**, pure white background, no shading, no gradients,
   > no text, centered, full body, isolated.
   الرسومات الثلاث في `examples/art/` مولّدة بهذا البرومبت.
3. **مكتبات مضمّنة**: `node src/cli.mjs icons` يعرضها كلها.
   - `{"type":"doodle","name":"reading"}` — Open Doodles (33 شخصية، CC0).
   - `{"type":"peep","seed":"ahmed"}` — Open Peeps، كل كلمة تعطي شخصًا مختلفًا (CC0).
   - `{"type":"tabler","name":"shopping-cart"}` — 5,130 أيقونة خطية (MIT)، تصفّحها على tabler.io/icons.
   - `{"type":"icon","name":"rocket"}` — أيقونات الماركر المضمّنة.

## اليد

- المضمّنة: `"hand": "marker-a"` (افتراضي) أو `"marker-b"` (يد حقيقية بماركر أسود) أو `"cartoon"`.
- يدك أنت: صوّر يدك من أعلى وهي تمسك قلمًا على ورقة بيضاء، ثم:
  ```bash
  node src/cli.mjs hand my-hand.jpg          # يقصّ الخلفية تلقائيًا (rembg)
  ```
  ثم في السيناريو: `"hand": { "src": "assets/hands/my-hand.png", "tip": [x, y], "height": "58%" }`
  حيث `tip` موضع طرف القلم بالبكسل داخل الصورة. `{"hidden": true}` يخفي اليد.

## الصوت

الافتراضي مجاني بلا مفتاح (Microsoft Edge). النص يُقسَّم إلى جُمل بوقفات طبيعية، لذا اكتب بعلامات ترقيم عربية (، ؟ .).
الأصوات: `node src/cli.mjs voices` — جرّب `ar-EG-Shakir`، `ar-SA-Hamed`، أو `Andrew` (متعدد اللغات، نبرة أفضل ولكنة خفيفة).

للجودة الأعلى بدّل المزوّد بمتغير بيئة `DOODLE_TTS`:

| المزوّد | الجودة العربية | التكلفة | ما تحتاجه |
|---|---|---|---|
| `edge` (افتراضي) | جيدة | مجاني | لا شيء |
| `azure` | جيدة + تحكم SSML | مجاني 500 ألف حرف/شهر | `AZURE_TTS_KEY` + `AZURE_TTS_REGION` |
| `google` | ممتازة (Chirp3-HD) | مجاني مليون حرف/شهر | `GOOGLE_TTS_KEY` |
| `gemini` | ممتازة وقابلة للتوجيه («اقرأ بلهجة مصرية») | مجاني (حصة يومية) | `GEMINI_API_KEY` |
| `openai` | تعتمد على النموذج | مجاني محليًا | خادم متوافق مع OpenAI على `TTS_ENDPOINT` |

**نماذج عربية مفتوحة بجودة عالية** (تحتاج كرت شاشة أو Google Colab المجاني): **Habibi-TTS** (Apache-2.0، لهجات مصرية وخليجية،
استنساخ صوت)، **Chatterbox** المصري (MIT)، **SILMA-TTS** (Apache-2.0، فصحى). شغّل أيًا منها خلف خادم متوافق مع OpenAI
(مثل `chatterbox-tts-api`) ثم `DOODLE_TTS=openai TTS_ENDPOINT=http://localhost:8004/v1`.

## الوكيل الذكي: من فكرة إلى سيناريو كامل

```bash
node src/cli.mjs ai brief.txt -o script.json --format 16:9 --lang ar     # Ollama محليًا (مجاني) أو أي API متوافق
```
أو انسخ `prompts/script-writer.md` في أي مساعد (Claude / ChatGPT / Gemini) مع فكرتك. الوكيل يختار الشخصيات والأيقونات
من المكتبات المضمّنة، وإن احتاج رسمة خاصة يضع لك برومبتها الجاهز في `artRequests`.

## صيغة السيناريو (مختصر)

```json
{
  "format": "16:9", "voice": "ar-EG-Shakir", "hand": "marker-a", "tts": "edge",
  "music": "music.mp3", "musicVolume": 0.12,
  "scenes": [ {
    "narration": "ما يقوله المعلّق.",
    "camera": { "from": { "scale": 1 }, "to": { "scale": 1.05 } },
    "elements": [
      { "type": "image",  "src": "art/shop-owner.png", "x": "4%", "y": "8%", "w": "50%", "h": "84%", "draw": 6 },
      { "type": "text",   "text": "عنوان قصير", "x": "58%", "y": "30%", "w": "38%", "h": "26%", "size": "9%", "align": "right" },
      { "type": "shape",  "shape": "underline", "x": "58%", "y": "56%", "w": "38%", "h": "6%", "color": "#e63946" },
      { "type": "peep",   "seed": "sara", "x": "60%", "y": "50%", "w": "30%", "h": "45%" }
    ] } ]
}
```
- `format`: `16:9` · `9:16` · `1:1` · `4:5`. `transition`: `fade` · `slide` · `slide-up` · `cut`.
- `x y w h` نِسب من الشاشة. `draw` ثواني الرسم، `at` وقت البدء داخل المشهد، `until` وقت الإخفاء، `rotate` دوران.
- مدة كل مشهد تُحسب من طول الصوت تلقائيًا وتتوزّع عليها الرسومات.

## كيف تعمل داخليًا
`src/project.mjs` يجهّز الأصول والتوقيت → `src/tts.mjs` يولّد الصوت → داخل Chromium: `strokes-core.js` +
`skeleton-tracing-js` (MIT) يحوّلان أي صورة إلى ضربات قلم مرتّبة، و`engine.js` يرسم كل إطار (الخطوط، النص، اليد، الكاميرا)
→ `src/render.mjs` يلتقط الإطارات إلى ffmpeg مع الصوت → `video.mp4`.

## ملاحظات صريحة
- أصوات Edge مجانية عبر الإنترنت وليست واجهة رسمية معلنة؛ إن توقفت يومًا فالبدائل أعلاه جاهزة بتغيير متغير واحد.
- الصور المولّدة بالذكاء الاصطناعي: راجع شروط الأداة التي تستخدمها للاستعمال التجاري (Microsoft Designer يسمح به).
- الخطوط مضمّنة برخصة SIL OFL، الشخصيات CC0، أيقونات Tabler برخصة MIT. اليدان المضمّنتان مولّدتان خصيصًا لهذه الأداة.
- السرعة: فيديو 60 ثانية 1080p ≈ 3–5 دقائق على جهاز عادي. استخدم `--draft` أثناء التجربة.
