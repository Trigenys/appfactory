# AppFactory: Neon → Cloudflare Worker secrets, sans copie manuelle

## But

AppFactory peut désormais **vérifier une base Neon autorisée**, créer un rôle et
une base dédiés uniquement si la configuration l'autorise, récupérer son URI
PostgreSQL **côté Worker**, puis enregistrer la connexion sous forme de secret
dans le Worker Cloudflare approuvé.

L'automatisation réutilise les fonctions `listSecretNames` et `putSecret`
déjà employées pour Product Identity dans `src/brownfield-worker.ts`. Elle ne
nécessite ni mot de passe dans GitHub ni téléchargement local.

**Limite fondamentale :** pour appeler Neon directement depuis AppFactory,
AppFactory doit posséder une autorisation Neon. Une fois, ajouter
`NEON_API_KEY` comme **Secret** du Worker Cloudflare `appfactory-api`.
Le connecteur Neon de ChatGPT ne transfère pas automatiquement son accès à un
Worker Cloudflare. Ne pas copier cette clé dans un message, issue ou commit.
Utiliser une clé à portée réduite, si disponible, et la révoquer/rotater
selon la politique de sécurité.

## Architecture

```text
GitHub Actions OIDC (workflow canonique, main, push ou dispatch)
    |
    | POST /infrastructure/neon
    v
AppFactory (vérification OIDC + liste blanche serveur)
    |                                  |
    | NEON_API_KEY (secret Cloudflare)  | CLOUDFLARE_API_TOKEN
    v                                  v
Neon REST API                        Cloudflare REST API
  role / base existants ?             GET secrets worker
  éventuellement créer                PUT secret_text
  GET connection_uri                     |
    |                                    v
    +------------------------> Secret Worker Cloudflare autorisé
                                    |
                                    v
                           Collecteur / runtime du projet
```

Le mot de passe Postgres ne quitte jamais la zone serveur AppFactory → Cloudflare.
Seuls `status`, `repository`, `database`, `worker`, `secretName`,
`createdRole` et `createdDatabase` reviennent au workflow. Aucun URI,
mot de passe, clé Neon ou corps d'erreur de prestataire n'est journalisé.

## Contrat HTTP

`POST /infrastructure/neon` ; `Authorization: Bearer <GitHub OIDC>`.
Audience OIDC: `appfactory-api`.

Body autorisé (uniquement ce champ) :

```json
{"repository":"Trigenys/trigenys-seo-monitor"}
```

Conditions obligatoires :
- certificat JWT issu de GitHub, valide, audience attendue et `refs/heads/main` ;
- workflow officiel `.github/workflows/appfactory-infrastructure.yml` : événement `push` sur `main` ou `workflow_dispatch` ;
- l'identité exceptionnelle `.github/workflows/seo-monitor.yml` reste limitée à `workflow_dispatch` ;
- repo présent dans la liste blanche côté AppFactory ;
- aucun projectId, secretName, workerName ni URL fourni dans la requête.

Le `push` ne suffit pas à autoriser une cible : le dépôt doit aussi être présent dans la liste blanche serveur AppFactory. Si le secret Cloudflare cible existe déjà, renvoie `ALREADY_CONFIGURED`
**sans le remplacer** et sans appeler Neon. Les rotations doivent être
explicitement traitées séparément.

## Cible SEO Monitor déjà approuvée

`Trigenys/trigenys-seo-monitor` pointe vers :
- Neon project `little-frog-93793324`, branche `br-twilight-star-b2orr8hw`;
- rôle `seo_monitor_owner` et base `seo_monitor` déjà existants ;
- Worker Cloudflare `appfactory-api` ;
- nouveau secret `APPFACTORY_DATABASE_TRIGENYS_SEO_MONITOR_URL` ;
- `createMissing=false` : aucune création sur la branche partagée si la
  base ou le rôle viennent à manquer. Product Identity reste intact.

Dès que `NEON_API_KEY` est configuré, exécuter SEO Monitor en mode `full`
déclenche automatiquement ce provisionnement, puis le collecteur obtient
sa connexion via le bail OIDC déjà implémenté.

## Ajouter un futur projet

Le Worker AppFactory peut aussi recevoir une **variable serveur**
`APPFACTORY_NEON_TARGETS` contenant une map JSON `repository → cible`.
Cette map n'est jamais fournie par les workflows appelants :

```json
{
  "Trigenys/future-service": {
    "projectId": "NEON_PROJECT_ID",
    "branchId": "NEON_BRANCH_ID",
    "databaseName": "future_service",
    "roleName": "future_service_owner",
    "workerName": "future-service-api",
    "secretName": "FUTURE_SERVICE_DATABASE_URL",
    "createMissing": true
  }
}
```

Le Worker de destination doit être `<nom-du-repo>-api`. Le nom du secret
doit commencer par le préfixe propre au dépôt (majuscule + underscores).
La cible AppFactory globale de SEO Monitor est scellée dans le code et
ne peut pas être surchargée via cette variable.

Les seules mutations prises en charge sont créer un rôle manquant, créer une
base manquante et ajouter un secret Worker **absent**. Pas de suppression,
pas d'écrasement des secrets existants, pas de changement du propriétaire
d'une base existante, pas de choix de cible depuis les requêtes GitHub.

## Prérequis d'autorisation

- `NEON_API_KEY` — secret Cloudflare Worker `appfactory-api`.
  La clé doit pouvoir lire les rôles, bases et URI de connexion du projet
  approuvé ; la création de rôles/bases est nécessaire uniquement pour les
  cibles avec `createMissing=true`.
- `CLOUDFLARE_ACCOUNT_ID` — déjà configuré.
- `CLOUDFLARE_PAGES_D1_TOKEN` (priorité) ou `CLOUDFLARE_API_TOKEN` —
  déjà configuré pour la gestion Worker. Doit disposer de
  **Workers Scripts Read** et **Workers Scripts Write** sur le compte cible.

L'absence de `NEON_API_KEY` renvoie le code
`NEON_API_KEY_NOT_CONFIGURED`, sans fuite de secrets ni faux succès.

## Contrôle

1. Fusionner AppFactory, vérifier que `Workers Builds: appfactory-api` est vert.
2. Ajouter seulement `NEON_API_KEY` dans le Worker AppFactory.
3. Lancer le workflow `SEO Monitor` en `full`.
4. Vérifier `ALREADY_CONFIGURED` ou `PROVISIONED`, puis le bail OIDC
   et la collecte réelle dans Neon.
5. Interroger Neon pour la table `seo_monitor_runs` et au moins une ligne.
   Ne pas considérer un build ou une authentification Google comme preuve
   de collecte PostgreSQL.

Le test `npm run test:neon-provisioning` simule Neon et Cloudflare,
incluant tentatives inter-dépôts, écrasement, erreurs et mauvais propriétaires.
Aucun test de CI ne dépend d'une véritable clé Neon.


## Hyperdrive : secret dédié par profil

Pour un projet existant qui possède déjà sa base Neon, AppFactory peut résoudre un profil
Hyperdrive depuis un secret Cloudflare dédié sans réécrire le secret historique
`HYPERDRIVE_DATABASE_PROFILES`.

Convention :

```text
HYPERDRIVE_DATABASE_PROFILE__<PROFILE_NORMALISÉ>
```

Exemple pour `trigenys-editorial-os-staging` :

```text
HYPERDRIVE_DATABASE_PROFILE__TRIGENYS_EDITORIAL_OS_STAGING
```

La valeur est un objet JSON de profil Hyperdrive contenant `origin.scheme`, `host`,
`port`, `database`, `user` et `password`. Ce secret reste uniquement dans le Worker
`appfactory-api`. Le secret dédié est prioritaire pour ce profil ; les autres projets
continuent d'utiliser la map historique. Cela évite d'écraser des credentials existants
lorsqu'un nouveau projet brownfield est raccordé.
