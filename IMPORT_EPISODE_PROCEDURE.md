# Процедура импорта эпизода (полный цикл)

**Делать строго по шагам. Не пропускать шаги.**

---

## Один новый эпизод (например, №14)

### 1. Куки (если ещё не делали)

```bash
npx tsx scripts/auth.ts
```

Залогиниться на innerfrench.com → куки сохраняются в `scripts/data/.cookies.json`.

### 2. Импорт (транскрипт FR + таймкоды)

```bash
npx tsx scripts/importEpisode.ts https://innerfrench.com/14-comment-creer-heros-parfait/
```

Результат: `scripts/data/episode_14.json` (или номер другого эпизода).

### 3. Пуш в Supabase (эпизод + сегменты)

```bash
node -e "const fs=require('fs'); const d=JSON.parse(fs.readFileSync('scripts/data/episode_14.json','utf8')); fs.writeFileSync('scripts/data/episodes_14-14.json', JSON.stringify([d], null, 2));"
npx tsx scripts/pushToSupabase.ts scripts/data/episodes_14-14.json
```

(Для другого номера заменить `14` на нужный.)

### 4. Перевод сегментов FR → RU (обязательно)

**Вариант A — Google Translate (проще, без Python):**

```bash
npx tsx scripts/autoTranslate.ts
```

Переводит все сегменты в БД, у которых `ru_text` пустой.

**Вариант B — нейросеть (argostranslate):**

```bash
pip install argostranslate supabase python-dotenv
python scripts/translate_neural.py
```

### 5. Проверка

В приложении открыть эпизод: должны быть таймкоды, французский и русский текст у сегментов.

---

## Несколько эпизодов (батч)

### 1. Список и URL

```bash
npx tsx scripts/fetchEpisodeList.ts
npx tsx scripts/resolveUrls.ts 1 190
```

### 2. Импорт батча

```bash
npx tsx scripts/importEpisode.ts --batch 13 20
```

Результат: `scripts/data/episodes_13-20.json`.

### 3. Пуш в Supabase

```bash
npx tsx scripts/pushToSupabase.ts scripts/data/episodes_13-20.json
```

### 4. Перевод (обязательно)

```bash
npx tsx scripts/autoTranslate.ts
```

или `python scripts/translate_neural.py`.

---

## Если эпизод уже в БД, но без перевода

Только шаг 4:

```bash
npx tsx scripts/autoTranslate.ts
```

---

## Краткий чеклист (один эпизод)

- [ ] `auth.ts` (если куки нет)
- [ ] `importEpisode.ts <url>`
- [ ] Собрать `episodes_N-N.json` из `episode_N.json`
- [ ] `pushToSupabase.ts episodes_N-N.json`
- [ ] **`autoTranslate.ts`** ← не пропускать
