# USSL — conversation privée à deux

USSL est une petite application web mobile (installable comme PWA) et un conteneur Android Capacitor. Elle comprend les messages texte, les photos, vidéos et fichiers de moins de 10 Mo. Les données sont temporaires : elles restent uniquement dans la mémoire vive du serveur et ne sont jamais enregistrées sur le disque.

## Déploiement sur `ussl.nexalink.fr`

Le déploiement fourni utilise Docker et nécessite un VPS ou un hébergement compatible Docker/Node.js. Un hébergement web mutualisé limité à PHP ne pourra pas exécuter ce serveur tel quel. Les messages et fichiers disparaissent aussi lors d’un redémarrage du serveur.

1. Copier le dossier sur un serveur disposant de Docker et Docker Compose.
2. Créer `.env` avec `USSL_SECRET=` suivi d’une phrase aléatoire d’au moins 32 caractères. Garder cette clé privée et la transmettre uniquement à l’autre personne.
3. Lancer `docker compose up -d --build`.
4. Dans le panneau DNS de `nexalink.fr`, faire pointer `ussl` vers le serveur. Configurer un proxy HTTPS (par exemple Nginx/Caddy) vers `127.0.0.1:3000`, avec le certificat TLS du sous-domaine.
5. Ouvrir `https://ussl.nexalink.fr` sur les deux téléphones. Chaque personne saisit son prénom et la même clé secrète. Sur Android, le navigateur peut aussi installer l’application depuis son menu.

La clé `USSL_SECRET` autorise les deux interlocuteurs. Le nom est un libellé de conversation, pas une vérification d’identité. Utiliser obligatoirement HTTPS pour protéger la clé pendant le transport. Les messages et pièces jointes sont effacés pour les deux personnes dès qu’une personne ferme l’application ou l’onglet. En cas de fermeture brutale, le serveur les efface après 20 secondes sans activité. Le bouton « Supprimer toute la conversation » les efface immédiatement. Les pièces jointes utilisent au maximum 50 Mo de mémoire vive au total. Les données ne sont pas chiffrées de bout en bout.

## Générer l’APK Android

Le dossier ne contient pas d’APK précompilé. Le projet utilise GitHub Actions pour compiler avec le SDK Android. Pousser le dossier dans un dépôt GitHub, ouvrir **Actions → Build USSL APK → Run workflow**, puis télécharger l’artefact `USSL-APK` à la fin du build. L’APK debug s’installe après autorisation des applications provenant de cette source. Il ouvrira `https://ussl.nexalink.fr`; déployer le serveur avant de distribuer l’application.

L’application web fonctionne aussi dans Chrome Android sans APK via **Installer l’application** / **Ajouter à l’écran d’accueil**.

## Démarrage local sans Docker

Installer Node.js 18 ou ultérieur, copier `.env.example` en `.env` dans le dossier du projet, puis modifier la ligne `USSL_SECRET=` avec une clé aléatoire de 32 caractères minimum. Depuis une invite de commande ouverte dans ce dossier, lancer `npm start`. Le serveur lit `.env` automatiquement et écoute sur le port `3000`. Ouvrir ensuite `http://localhost:3000`. Les messages et fichiers ne sont écrits dans aucun dossier.
