import LegalPage, { LegalSection } from '@/components/LegalPage';

export const metadata = { title: 'Conditions d’utilisation — Personal Generative Studio' };

export default function TermsPage() {
  return (
    <LegalPage title="Conditions d’utilisation" updated="18 octobre 2026">
      <LegalSection title="Le service">
        <p>Personal Generative Studio est un studio privé de création d’images, de vidéos et de voix par intelligence artificielle. Il est utilisé par son propriétaire, pour ses propres projets et pour ceux de ses clients.</p>
        <p>L’accès est réservé aux adresses autorisées par le propriétaire. Le service n’est pas ouvert à l’inscription.</p>
      </LegalSection>
      <LegalSection title="Publication sur les réseaux sociaux">
        <p>Le propriétaire peut connecter ses comptes Facebook, Instagram et TikTok. Le studio ne publie que sur les comptes connectés, et seulement après une action explicite : publication immédiate ou programmée à une date choisie.</p>
        <p>Le propriétaire choisit la légende et, sur TikTok, le niveau de confidentialité avant chaque publication. Il peut déconnecter un compte ou annuler une publication programmée à tout moment.</p>
        <p>Chaque publication reste soumise aux conditions d’utilisation du réseau concerné.</p>
      </LegalSection>
      <LegalSection title="Contenus générés">
        <p>Les contenus sont produits par des modèles d’IA tiers. Le propriétaire reste responsable de leur vérification et de leur usage, notamment du respect des droits d’auteur, du droit à l’image et des règles des plateformes.</p>
        <p>Les contenus générés par IA sont signalés comme tels lorsque la plateforme ou la loi l’exige.</p>
      </LegalSection>
      <LegalSection title="Disponibilité">
        <p>Le service est fourni tel quel. Il peut être interrompu ou modifié, et dépend de services tiers (Vercel, Convex, les fournisseurs de modèles, Meta, TikTok).</p>
      </LegalSection>
      <LegalSection title="Contact">
        <p>Pour toute question : hello@beindigital.fr.</p>
      </LegalSection>
    </LegalPage>
  );
}
