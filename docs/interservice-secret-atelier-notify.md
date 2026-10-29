# AppFactory · clé interservices Atelier Maître ↔ Trigenys Notify

## Contrat pilote à périmètre fixe

**Un seul producteur :** `EagleFox31/atelier2026`. **Un seul consommateur :** `trigenys-notify-staging-api` sur Cloudflare, compte `28007ba3301ed34cfeb04c2a19b68e9f`.

AWS SSM (source de vérité) : `/atelier-maitre/prod/notify-ingest-key`, type **SecureString** (valeur aléatoire de 32 octets, hexadécimal 64 caractères).

Cloudflare Worker (copie) : `ATELIER_NOTIFY_INGEST_KEY`, secret chiffré, jamais une variable en clair.

Atelier Maître, lors du prochain **déploiement contrôlé** : la même valeur est lue depuis AWS SSM et injectée dans le conteneur API sous `TRIGENYS_NOTIFY_INGEST_KEY`. L'ancien paramètre SSM `/atelier-maitre/prod/env` n'est ni réécrit ni remplacé.

## Circuit d'approvisionnement

1. Le workflow **manuel** `.github/workflows/appfactory-interservice-secrets.yml`, depuis le main protégé d'Atelier Maître, obtient un rôle AWS temporaire avec GitHub OIDC. Aucune clé AWS statique dans GitHub.
2. Lit `/atelier-maitre/prod/notify-ingest-key` : si absent, produit 32 octets cryptographiquement aléatoires et crée le SecureString **sans overwrite**. Si présent, le réutilise et en valide le format.
3. Vérifie la lecture SSM et obtient un **second JWT OIDC**, audience `appfactory-api`. Il transmet, via HTTPS avec ce JWT, la valeur directement au broker AppFactory.
4. AppFactory vérifie la signature JWT, l'issuer, l'audience, le dépôt `EagleFox31/atelier2026`, la ref `refs/heads/main`, l'événement `workflow_dispatch` et le chemin exact du workflow. Il refuse toute cible différente, tout champ supplémentaire et toute valeur non conforme.
5. Si le secret Cloudflare n'existe pas : il le crée avec l'API de secrets Cloudflare déjà utilisée par AppFactory. S'il existe : **aucun overwrite**.
6. Dans les deux cas, AppFactory demande une preuve à `POST /v1/dispatch/atelier/credential-check` sur Notify. Cette route utilise une comparaison à temps constant et répond 204 sur correspondance. Elle ne peut déclencher aucun envoi Meta, même si le canal était activé. Une divergence existante retourne 409 ; une valeur créée mais non encore disponible retourne 503 et se réessaye avec **la même clé SSM**, jamais une nouvelle.
7. Les réponses API et les sorties CI ne contiennent ni clé, ni token Meta, ni token AWS. La valeur n'est pas mise en GitHub Actions Outputs ou en artifact.

## Préparatifs / contrôles bloquants

- Les endpoints AppFactory et Trigenys Notify **doivent être déployés et vérifiés** avant de lancer manuellement le workflow.
- Le rôle AWS `AWS_DEPLOY_ROLE_ARN` utilisé par Atelier doit accepter `ssm:GetParameter` et `ssm:PutParameter` uniquement sur `arn:aws:ssm:eu-west-3:<account-id>:parameter/atelier-maitre/prod/notify-ingest-key` (ainsi que la configuration KMS applicable). Le rôle EC2 dispose déjà de l'accès `ssm:GetParameter` sur `parameter/atelier-maitre/prod/*`.
- Si la permission `ssm:PutParameter` manque, l'exécution échoue : **ne pas élargir à `ssm:*` ni aux paramètres d'autres produits**. Faire autoriser la permission ciblée.
- `ATELIER_META_DISPATCH_ENABLED` doit rester `false` dans Cloudflare. `CUSTOMER_NOTIFICATIONS_MODE` reste `off` côté Atelier jusqu'à une recette approuvée.
- Après exécution réussie, un déploiement contrôlé d'Atelier récupère la clé via `deploy/scripts/aws-ssm-deploy.sh` ; aucune bascule de fournisseur n'est automatique.
- Le nom `staging-v1` est intentionnel : cet approvisionnement lie aujourd'hui une API de produit AWS à un **Worker Notify staging**. Il ne constitue pas une autorisation de bascule en production ni un modèle générique multi-tenants.

## Recette sans message réel

Après les déploiements, lancer le workflow manuel et vérifier une réponse `PROVISIONED` ou `ALREADY_CONFIGURED` sans aucune valeur secrète. Vérifier **uniquement le nom** du secret Cloudflare et le statut 204 du contrôle privé effectué par le broker. Ne pas exécuter `/v1/dispatch/atelier/whatsapp` dans le cadre du provisioning ; le test WhatsApp avec destinataire consentant vient dans un changement séparé et contrôlé.

## Rotation

Ne jamais « régénérer pour voir » : le protocole est create-if-absent et compare l'existant. Une rotation doit disposer d'une procédure dédiée avec double-acceptation temporaire, validation des deux magasins, bascule puis révocation ; **elle n'est pas implémentée dans ce pilote**. En cas de divergence, arrêt sans modification.
