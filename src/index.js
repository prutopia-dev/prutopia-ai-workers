/**
 * ════════════════════════════════════════════════════════════════════════
 * WORKER CLOUDFLARE — Proxy Anthropic mutualisé Pr'Utopia
 * ════════════════════════════════════════════════════════════════════════
 * Rôle : recevoir les requêtes de génération depuis le backend Next.js,
 * y ajouter la clé Anthropic (qui ne quitte jamais le Worker), et relayer
 * vers l'API. Mutualisé entre projets Pr'Utopia.
 *
 * ── CHANGEMENT SÉCURITÉ vs version vanilla ──
 * Avant : le Worker était OUVERT. N'importe qui connaissant l'URL pouvait
 *         l'appeler et cramer les crédits Anthropic.
 * Maintenant : seules les requêtes portant le bon secret partagé
 *         (Authorization: Bearer <WORKER_SHARED_SECRET>) sont acceptées.
 *         Ce secret n'est connu QUE du backend Next (côté serveur), jamais
 *         exposé au navigateur. La porte ouverte est fermée.
 *
 * Secrets (jamais en clair, via `wrangler secret put`) :
 *   - ANTHROPIC_API_KEY   : la clé API Anthropic
 *   - WORKER_SHARED_SECRET : le secret partagé avec Next
 *
 * Comparaison en temps constant pour éviter les attaques temporelles.
 */

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';

/** Comparaison de chaînes en temps constant (anti timing-attack). */
function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export default {
  async fetch(request, env) {
    // 1) Méthode : on n'accepte que POST.
    if (request.method !== 'POST') {
      return json({ error: 'Method not allowed' }, 405);
    }

    // 2) Authentification par secret partagé.
    const auth = request.headers.get('Authorization') || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    if (!env.WORKER_SHARED_SECRET || !safeEqual(token, env.WORKER_SHARED_SECRET)) {
      // 401 volontairement laconique : pas d'indice sur ce qui a échoué.
      return json({ error: 'Unauthorized' }, 401);
    }

    // 3) Lire et transmettre le corps tel quel (Next a déjà construit
    //    le payload : model, max_tokens, system, messages).
    let payload;
    try {
      payload = await request.json();
    } catch {
      return json({ error: 'Invalid JSON body' }, 400);
    }

    // 4) Garde-fou : on borne max_tokens même si Next l'envoie.
    if (typeof payload.max_tokens !== 'number' || payload.max_tokens > 8000) {
      payload.max_tokens = 8000;
    }

    // 5) Relayer vers Anthropic avec la clé (jamais exposée au client).
    try {
      const upstream = await fetch(ANTHROPIC_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': env.ANTHROPIC_API_KEY,
          'anthropic-version': ANTHROPIC_VERSION,
        },
        body: JSON.stringify(payload),
      });

      // On renvoie le corps Anthropic tel quel, en forçant le content-type.
      const text = await upstream.text();
      return new Response(text, {
        status: upstream.status,
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (err) {
      return json({ error: 'Upstream request failed' }, 502);
    }
  },

  /**
   * Cron Trigger — rotation automatique des défis.
   *
   * Cloudflare appelle ce handler selon la planification définie dans
   * wrangler.toml ([triggers] crons). À chaque exécution, on demande à
   * Supabase de tourner le défi SI l'échéance est atteinte ET le planning
   * activé (toute la logique vit dans la fonction Postgres cron_rotate_if_due,
   * qui est idempotente). Le Worker ne fait qu'appuyer sur le bouton.
   *
   * Sécurité : on appelle Supabase avec la SECRET KEY (jamais exposée), via
   * l'endpoint RPC REST. La clé vit en secret Wrangler.
   */
  async scheduled(event, env, ctx) {
    ctx.waitUntil(
      (async () => {
        try {
          const res = await fetch(
            `${env.SUPABASE_URL}/rest/v1/rpc/cron_rotate_if_due`,
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                apikey: env.SUPABASE_SECRET_KEY,
                Authorization: `Bearer ${env.SUPABASE_SECRET_KEY}`,
              },
              body: '{}',
            }
          );
          if (!res.ok) {
            console.error('cron rotate failed', res.status, await res.text());
          }
        } catch (err) {
          console.error('cron rotate error', err);
        }
      })()
    );
  },
};
