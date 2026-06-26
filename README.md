# Pr'Utopia — AI Worker

Proxy Anthropic **mutualisé** entre les projets Pr'Utopia (Ludo, etc.).
Il détient la clé API Anthropic et n'accepte que les requêtes authentifiées
par un secret partagé. Aucun projet n'appelle Anthropic directement.

## Déploiement via GitHub (sans Node local)

Ce Worker se déploie automatiquement depuis GitHub, comme l'app :

1. Pousse ce dossier dans son propre repo GitHub (`prutopia-ai-worker`).
2. Dashboard Cloudflare → Workers & Pages → Create → Import a repository →
   choisis ce repo.
3. Cloudflare détecte le Worker (présence de wrangler.toml) et le déploie.
4. Pose les secrets dans le dashboard (voir ci-dessous).
5. Les pushes suivants redéploient automatiquement.

## Secrets (dans le dashboard Cloudflare)

Workers & Pages → (ce worker) → Settings → Variables and Secrets.
Crée ces 4 variables en type **Secret** :

- `ANTHROPIC_API_KEY`    — ta clé Anthropic
- `WORKER_SHARED_SECRET` — identique à celui configuré côté app Ludo
- `SUPABASE_URL`         — https://xxxx.supabase.co
- `SUPABASE_SECRET_KEY`  — sb_secret_...

Les deux premiers servent à appeler Anthropic en sécurité ; les deux derniers
permettent au cron de faire tourner les défis automatiquement.

## Sécurité

- Clé Anthropic : jamais exposée, vit uniquement ici (secret Cloudflare).
- Tout appel sans le bon secret partagé → 401 (comparaison en temps constant).
- Seules les requêtes POST sont acceptées.
