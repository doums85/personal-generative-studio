import LegalPage, { LegalSection } from '@/components/LegalPage';

export const metadata = { title: 'Politique de confidentialité — Personal Generative Studio' };

export default function PrivacyPage() {
  return (
    <LegalPage title="Politique de confidentialité" updated="18 octobre 2026">
      <LegalSection title="Données que le studio conserve">
        <p>Le studio conserve les projets, les références (images et descriptions), les contenus générés avec leurs paramètres, et l’historique des publications. Ces données sont stockées chez Convex, avec les fichiers médias.</p>
        <p>Le compte du propriétaire est protégé par un mot de passe haché. Aucune donnée n’est vendue ni utilisée pour de la publicité.</p>
      </LegalSection>
      <LegalSection title="Comptes Facebook, Instagram et TikTok">
        <p>Quand le propriétaire connecte un compte, le studio reçoit un jeton d’accès. Il lit uniquement le nom, l’identifiant et la photo du compte, et la liste des Pages et comptes Instagram professionnels liés. Pour TikTok : l’identifiant, le nom affiché et l’avatar.</p>
        <p>Les jetons sont chiffrés avant d’être stockés. Ils servent uniquement à publier les contenus choisis par le propriétaire. Déconnecter un compte, ou supprimer le projet, efface ses jetons.</p>
        <p>Vous pouvez aussi retirer l’accès du studio depuis les réglages de sécurité de Facebook, d’Instagram ou de TikTok.</p>
      </LegalSection>
      <LegalSection title="Services tiers">
        <p>Les textes et les images envoyés pour générer un contenu sont traités par les fournisseurs de modèles d’IA choisis dans le studio, via Vercel AI Gateway. L’hébergement est assuré par Vercel et la base de données par Convex.</p>
      </LegalSection>
      <LegalSection title="Vos droits">
        <p>Vous pouvez demander l’accès, la correction ou la suppression de vos données en écrivant à hello@beindigital.fr.</p>
      </LegalSection>
    </LegalPage>
  );
}
