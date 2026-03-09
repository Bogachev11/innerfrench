# Deploy checklist — do every time

Use this list so prod is never broken or stale.

## Once (first time or new project)

- [ ] **Vercel → Project → Settings → Environment Variables (Production)**  
  Add all four; without them build may pass but APIs fail:
  - `NEXT_PUBLIC_SUPABASE_URL`
  - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
  - `OPENAI_API_KEY`
  - **`SUPABASE_SERVICE_ROLE_KEY`** ← Word Count Lemmas API and word-info/prefill need this. If missing → 503 and "Lemmas API failed".

## Every deploy

1. [ ] Commit everything on `develop`, then: `npm run build` (must succeed).
2. [ ] `git checkout main && git pull origin main && git merge develop -m "Deploy: ..." && git push origin main`
3. [ ] **From project root, on branch main:** `npx vercel --yes --prod` (wait for "Production: https://..."). Do not rely on Git auto-deploy.
4. [ ] **Verify:** `npx tsx scripts/testProd.ts` (must pass; checks Words page and New UI).
5. [ ] **Manual check:** Open https://innerfrench.bogachev.fr/word-count — no "Lemmas API failed" (if you see it, add `SUPABASE_SERVICE_ROLE_KEY` in Vercel Production env and redeploy).
6. [ ] `git checkout develop`

If Word Count shows 503 on Lemmas API → add `SUPABASE_SERVICE_ROLE_KEY` in Vercel → Settings → Environment Variables → Production, then **Redeploy** (Deployments → … → Redeploy).
