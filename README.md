# USSL — conversation privée à deux

USSL est une application web mobile installable (PWA) et un conteneur Android Capacitor. Elle permet les messages texte, photos, vidéos et fichiers de moins de 10 Mo, ainsi que les appels audio et vidéo.

## Messages temporaires et lecture différée

Les messages et fichiers non lus restent uniquement en mémoire vive du serveur jusqu’à ce que l’autre personne ouvre la conversation et les voie. L’expéditeur peut fermer l’application : le message reste disponible pour le destinataire. Après affichage par le destinataire, le message et sa pièce jointe sont supprimés du serveur. Le contenu déjà affiché reste seulement dans la mémoire de la page ouverte et disparaît à sa fermeture ou son rechargement. Le bouton « Supprimer toute la conversation » efface immédiatement les données partagées.

Aucun message ni fichier n’est enregistré sur le disque. Un redémarrage du serveur efface les messages encore non lus. Les pièces jointes sont limitées à moins de 10 Mo chacune et à 50 Mo de mémoire vive au total. La file de messages est limitée pour protéger la mémoire du serveur; quand elle est pleine, le destinataire doit ouvrir la conversation et lire les messages en attente.

## Appels audio et vidéo

Les appels audio/vidéo ne sont pas enregistrés. Le son et l’image sont transmis en direct par WebRTC; le serveur USSL ne conserve que des signaux de connexion temporaires en mémoire vive. L’autorisation du microphone et, pour les appels vidéo, de la caméra est nécessaire. Les appels nécessitent HTTPS. Sans serveur TURN, certains réseaux restrictifs peuvent empêcher une connexion directe.

## Déploiement sur `ussl.nexalink.fr`

Le déploiement fourni utilise Node.js et nécessite un hébergement qui exécute une application serveur Node.js (ou un VPS). Un hébergement web mutualisé limité à PHP ne peut pas exécuter le serveur USSL tel quel.

1. Déployer le dossier du projet sur l’hébergement Node.js.
2. Définir la variable d’environnement `USSL_SECRET` avec une clé aléatoire d’au moins 32 caractères. Ne pas la publier sur GitHub.
3. Configurer le sous-domaine `ussl.nexalink.fr` pour cette application et activer HTTPS.
4. Ouvrir le sous-domaine sur les deux téléphones. Chaque personne saisit son prénom et la même clé secrète.

Le nom est un libellé, pas une vérification d’identité. La clé commune protège l’accès à la conversation, mais les données ne sont pas chiffrées de bout en bout.

## Générer l’APK Android

Le dépôt contient un workflow GitHub Actions de compilation. Dans **Actions → Build USSL APK**, télécharge l’artefact **USSL-APK** après un build réussi. L’APK debug s’installe après autorisation des applications provenant de cette source. Il ouvre `https://ussl.nexalink.fr`; le serveur doit donc être déployé et fonctionnel.

L’application web fonctionne aussi dans Chrome Android via **Installer l’application** / **Ajouter à l’écran d’accueil**.

## Démarrage local sans Docker

Installer Node.js 18 ou ultérieur, copier `.env.example` en `.env`, puis définir `USSL_SECRET` avec une clé aléatoire de 32 caractères minimum. Depuis le dossier du projet, lancer `npm start` et ouvrir `http://localhost:3000`. Les messages non lus sont gardés uniquement en mémoire vive jusqu’à leur lecture ou au redémarrage du serveur.
