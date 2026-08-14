# Deploy Plan: MedCalc → Cloudflare Workers (pierwsze wdrożenie)

## Context

Projekt ma kompletną konfigurację Cloudflare Workers (`wrangler.jsonc`, adapter `@astrojs/cloudflare`, SSR mode) oraz działający pipeline CI dla PR-ów. Brakuje: sekretów ustawionych w Workers, środowisk lokalnych (`.env` / `.dev.vars`) oraz kroku produkcyjnego deploy w CI. Plan obejmuje jedną zmianę kodu (`ci.yml`) i sekwencję ręcznych kroków.

Podstawa decyzji: `context/foundation/infrastructure.md` (Cloudflare Workers jako platforma MVP).

---

## Co jest gotowe (bez zmian)

- `wrangler.jsonc` — `name: "medcalc"` (root config = produkcja), `env.preview` = preview
- `@astrojs/cloudflare` adapter zainstalowany i skonfigurowany
- Middleware auth (`src/middleware.ts`) — ochrona `/dashboard`
- Preview deploy na PR-ach działa (`wrangler deploy --env preview`)

---

## Zmiana kodu

### ✅ `.github/workflows/ci.yml` — krok produkcyjnego deploy

Dodać po kroku `npm run build`, tylko na push do `master`:

```yaml
- name: Deploy to production
  if: github.event_name == 'push'
  uses: cloudflare/wrangler-action@v3
  with:
    apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
    command: deploy
```

`github.event_name == 'push'` odróżnia push do mastera od PR-ów (te mają event `pull_request`).

---

## Ręczne kroki (wymagane od użytkownika, w kolejności)

### ✅ Krok 0 — Założenie projektu Supabase Cloud

1. Wejdź na `supabase.com` → Sign up (konto GitHub lub email)
2. Po zalogowaniu: **New project**
   - Organization: wybierz lub utwórz (domyślna personal org jest ok)
   - Name: `medcalc`
   - Database Password: wygeneruj silne hasło i zapisz je bezpiecznie (potrzebne tylko do bezpośredniego dostępu do bazy, nie do aplikacji)
   - Region: wybierz najbliższy geograficznie (np. `eu-central-1` dla Europy)
   - Plan: **Free** (500 MB storage, 50 MB bazy, 2 projekty — wystarczy dla MVP)
3. Kliknij **Create new project** — provisioning trwa ok. 1 minuty
4. Po utworzeniu projektu pobierz oba klucze:
   - **SUPABASE_URL** → Settings → **Data API** → sekcja "Project URL"
   - **SUPABASE_KEY** → Settings → **API Keys** → klucz **publishable** (nie secret)

> Klucz `secret` pomija Row Level Security — nigdy nie trafia do kodu aplikacji.

### ✅ Krok 0b — Utworzenie repozytorium GitHub

1. Zaloguj się na `github.com` → kliknij **+** (góra strony) → **New repository**
2. Wypełnij formularz:
   - **Repository name:** `medcalc`
   - **Visibility:** Public lub Private — dane są w Supabase, sekrety w Workers; kod w repozytorium jest bezpieczny publicznie
   - **Nie zaznaczaj** Initialize this repository (README, .gitignore, license) — projekt ma już lokalne pliki
3. Kliknij **Create repository** → GitHub wyświetli URL repozytorium
4. W terminalu w katalogu projektu podepnij remote, zrób initial commit i wypchnij kod:
   ```bash
   git remote add origin https://github.com/<twoja-nazwa>/<repo>.git
   git add .
   git commit -m "chore: initial project setup"
   git branch -M master
   git push -u origin master
   ```

> Gałąź `master` (nie `main`) — tak skonfigurowane jest CI w tym projekcie.

### ✅ Krok 1 — Środowiska lokalne

```bash
cp .env.example .env
cp .env.example .dev.vars
```

Uzupełnić oba pliki wartościami z projektu Supabase Cloud:

- `SUPABASE_URL` → Project Settings → **Data API** → API URL (sama domena, bez `/rest/v1/` na końcu)
- `SUPABASE_KEY` → Project Settings → **API Keys** → klucz **anon**

### ✅ Krok 2 — Założenie konta Cloudflare i aktywacja Workers

1. Wejdź na `cloudflare.com` → **Sign up** (email + hasło lub SSO)
2. Potwierdź email (link weryfikacyjny od Cloudflare)
3. Po zalogowaniu: lewy sidebar → **Workers & Pages** → **Get started**
   - Cloudflare przeprowadzi przez jednorazowy onboarding: wybór subdomeny `*.workers.dev` i potwierdzenie planu **Free** (100k req/dzień — wystarczy dla MVP)
4. Konto gotowe do wdrożenia

### ✅ Krok 2b — Logowanie wrangler (jednorazowo)

```bash
npx wrangler login
```

Otwiera przeglądarkę → autoryzacja OAuth z kontem Cloudflare → token zapisywany lokalnie.

### ✅ Krok 3 — Sekrety produkcyjnego Workera

```bash
npx wrangler secret put SUPABASE_URL
npx wrangler secret put SUPABASE_KEY
```

Wrangler pyta o wartości interaktywnie. Dotyczy Workera `medcalc` (produkcja).

### ✅ Krok 4 — Sekrety preview Workera

```bash
npx wrangler secret put SUPABASE_URL --env preview
npx wrangler secret put SUPABASE_KEY --env preview
```

Dotyczy Workera `medcalc-preview`. Ten sam klucz Supabase co produkcja jest ok dla MVP.

### Krok 4b — Supabase URL Configuration (wymagane dla produkcji)

Link w mailu weryfikacyjnym Supabase przekierowuje na **Site URL** ustawiony w dashboardzie. Bez tego kroku użytkownicy po kliknięciu linka w mailu lądują na `localhost`.

1. Zaloguj się na `supabase.com` → wybierz projekt `medcalc`
2. Lewy sidebar → **Authentication** → **URL Configuration**
3. Ustaw **Site URL**: `https://medcalc.medcalc.workers.dev`
4. W sekcji **Redirect URLs** kliknij **Add URL** i dodaj: `https://medcalc.medcalc.workers.dev/**`
5. Kliknij **Save**

> Gwiazdka `/**` w redirect URL pozwala Supabase przekierować na dowolną ścieżkę w ramach domeny (np. `/auth/confirm-email`).

### ✅ Krok 5 — GitHub Secrets (weryfikacja / uzupełnienie)

Repo → Settings → Secrets and variables → Actions — sprawdzić, że istnieją:

- `CLOUDFLARE_API_TOKEN` — token z uprawnieniem "Edit Cloudflare Workers"
  - Jeśli brakuje: `dash.cloudflare.com` → My Profile → API Tokens → Create Token → szablon "Edit Cloudflare Workers"
- `SUPABASE_URL`
- `SUPABASE_KEY`

### ✅ Krok 6 — Pierwszy deploy

**Opcja A — lokalnie (natychmiast):**

```bash
npm run build
npx wrangler deploy
```

Output zawiera URL: `https://medcalc.<account>.workers.dev`

**Opcja B — przez CI (automatycznie po merge do master):**

Po zatwierdzeniu planu i dodaniu kroku do `ci.yml` — każdy push do `master` triggeruje deploy.

---

## Weryfikacja

1. **App ładuje się** — otworzyć URL z outputu `wrangler deploy`
2. **Strona główna** — publiczna, bez logowania
3. **Rejestracja** — `/auth/signup` → utwórz konto → sprawdź mail weryfikacyjny (Supabase)
4. **Logowanie** → redirect na `/dashboard`
5. **Ochrona routów** → `/dashboard` bez sesji → redirect na `/auth/signin`
6. **Wylogowanie** → sesja wyczyszczona

---

## Uwagi

- Supabase wymaga potwierdzenia emaila — flow `confirm-email` jest gotowy w projekcie
- Workers free tier: 100k req/dzień, 10ms CPU/req — wystarczy dla MVP; błąd `Worker exceeded CPU time limit` sygnalizuje przekroczenie limitu
- Preview deploy na PR-ach działa po zatwierdzeniu zmiany w `ci.yml`
