// Configuración de la app. La clave pública VAPID es pública por diseño;
// la privada va SOLO en el secreto VAPID_PRIVATE_KEY del repositorio.
window.VENTERO_CONFIG = {
  vapidPublicKey: 'BHslM_xxUI_osq0dtPTs5qg_foxR6qfFfWoSaQS1CrZ2-55D5ZwI7LG3LxQZQkkIpS73eIOsim7mHKMwrfdYN5c',
  // Se deduce solo de la dirección de GitHub Pages (usuario.github.io/repositorio).
  // Rellénalo solo si publicas la app en otro dominio, p. ej. 'miusuario/ventero-app'.
  repo: ''
};
