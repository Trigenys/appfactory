# AppFactory — délégation OIDC vers un document D1 privé

Ce composant est **réutilisable**, indépendant du schéma métier du projet, et s'appuie sur le contrôle d'identité GitHub Actions OIDC déjà implémenté dans `src/auth.ts`.

## Appel

`POST /infrastructure/d1/documents`

Le runner GitHub demande un jeton OIDC `audience=appfactory-api` à GitHub et envoie son assertion en `Authorization: Bearer ...`.

Les opérations exposées sont volontairement **fermées** : `{action:"read",document:"goals"}` ou `{action:"put",document:"audit",expectedVersion:0,value:{...}}`. Aucun identifiant de base, nom de secret, destination cloud ou instruction SQL n'est accepté depuis le consommateur.

La politique est déclarée dans `CONSUMERS` de `src/d1-document-broker.ts` :
- dépôt appelant ;
- liste précise des workflows, événements et branche protégée autorisés ;
- identifiant de la base D1 attitrée ;
- documents lisibles et modifiables.

Le profil initial est `EagleFox31/project-registry` : seuls `refresh.yml` et `command-center-reports.yml` depuis `main`, pour les événements approuvés, peuvent appeler le broker. Le journal `goals` est **strictement en lecture seule** pour ces workflows. Les écritures restent aux documents `audit`, `history`, `snapshot`, `snapshots` et `reports`. L'interface privée (via Cloudflare Access) demeure propriétaire des modifications d'objectifs.

## Sécurité et idempotence

AppFactory vérifie la signature GitHub OIDC RS256, l'audience, le dépôt, le workflow, la branche et l'événement. La désactivation du raccourci `ENVIRONMENT=development` est explicite pour cette API sensible.

AppFactory utilise son secret Worker existant `CLOUDFLARE_PAGES_D1_TOKEN` (avec fallback documenté `CLOUDFLARE_API_TOKEN`) pour interroger **uniquement** la base autorisée. Le token n'est jamais retourné à GitHub Actions.

Les écritures vérifient la version et utilisent un `UPDATE … WHERE version = ?` ou un `INSERT OR IGNORE`. Les conflits rendent `changes:0`, pour laisser le consommateur réconcilier sans perte. Les rapports finalisés (approved, sent ou error) ne peuvent pas être remplacés par un brouillon ; un nouveau rapport ne peut commencer qu'au statut `draft`.

Les charges sont limitées à 1,8 Mo de JSON par document, aucune réponse ne doit être mise en cache. Le jeton OIDC est à durée courte et doit être masqué dans les logs GitHub.

## RAIDER

- **R** : adapter D1 générique, contrats explicites et tests transport sans clonage d'un provisionneur par projet.
- **A** : noyau de transactions générique ; les cibles et droits sont des profils déclaratifs.
- **I** : résolution de CAS et conservation des identifiants de rapports.
- **D** : endpoints et workflows de provisioning existants inchangés.
- **E / R** : opérations auditables, rôles et identités validés, absence de copie des credentials dans les consumers.

### Validation

```bash
npm run typecheck
npm run test:d1-document-broker
npm run test:database-lease
npm run test:cloudflare-credential-routing
```

Cette première livraison n'active aucune diffusion externe ou mission Work. Ne pas exposer un endpoint D1 « SQL libre ». Les consommateurs doivent garder le principe du moindre privilège.
