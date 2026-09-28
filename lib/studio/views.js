/** Views handled by the Gateway-native studio shell (shared by the server page and the client shell). */
export const STUDIO_VIEWS = {
  home: { label: 'Accueil', icon: 'home', title: 'Tableau de bord' },
  image: { label: 'Image', icon: 'image', title: 'Image Studio' },
  video: { label: 'Vidéo', icon: 'video', title: 'Video Studio' },
  voice: { label: 'Voix', icon: 'wave', title: 'Voix off' },
  elements: { label: 'Références', icon: 'users', title: 'Base de références' },
  gallery: { label: 'Galerie', icon: 'grid', title: 'Galerie du projet' },
};

export function isStudioView(segment) {
  return !segment || segment === 'home' || Object.prototype.hasOwnProperty.call(STUDIO_VIEWS, segment);
}
