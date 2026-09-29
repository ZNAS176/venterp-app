# El Ventero CBV · App de temporada 2026/27

Una app web instalable (iPhone y Android) con el calendario, los resultados, las estadísticas
y los avisos de El Ventero CBV en Tercera FEB, Grupo B-A.

- **docs/**: la app (se publica gratis con GitHub Pages).
- **scripts/**: lee la ficha de cada partido en baloncestoenvivo.feb.es y envía los avisos.
- **.github/workflows/**: tareas automáticas de GitHub (cada hora, y al registrar un móvil).
- **push/**: móviles registrados y avisos ya enviados.

## Puesta en marcha (una sola vez, unos 15 minutos, desde el ordenador)

1. **Cuenta de GitHub.** Crea una gratis en https://github.com si no la tienes.
2. **Repositorio.** Pulsa *New repository*, llámalo `ventero-app`, márcalo **Public** y créalo.
3. **Subir los archivos.** En el repositorio vacío pulsa *uploading an existing file* y arrastra
   **todo el contenido** de esta carpeta (no la carpeta en sí). Incluye la carpeta `.github`:
   en Mac está oculta; en el Finder pulsa `Cmd + Mayús + .` para verla. Pulsa *Commit changes*.
4. **Clave secreta de los avisos.** *Settings → Secrets and variables → Actions → New repository secret*.
   - Name: `VAPID_PRIVATE_KEY`
   - Secret: el texto del archivo `CLAVE_PRIVADA_VAPID.txt` (que te he dado aparte).
   Después borra ese archivo de tu ordenador. No lo subas nunca al repositorio.
5. **Permisos.** *Settings → Actions → General → Workflow permissions*: elige
   **Read and write permissions** y guarda.
6. **Publicar la app.** *Settings → Pages*: Source *Deploy from a branch*, rama `main`, carpeta
   `/docs`, *Save*. En un par de minutos estará en `https://TU-USUARIO.github.io/ventero-app/`.
7. **Primera actualización.** Pestaña *Actions* → si lo pide, activa los workflows →
   *Actualizar datos FEB* → *Run workflow*. Debe terminar en verde.

## En el móvil

- **iPhone (iOS 16.4 o posterior):** abre la dirección en **Safari** → *Compartir* →
  *Añadir a pantalla de inicio*. Abre la app **desde el icono**.
- **Android:** abre la dirección en **Chrome** → *Instalar* (o menú ⋮ → *Instalar app*).

Después, en la app: **Activar avisos** → acepta las notificaciones → **Registrar este móvil en GitHub**
→ pulsa *Create* (hay que estar con la sesión de GitHub iniciada). En un minuto llega una notificación
de prueba. Repite en cada móvil que quieras avisar (con tu cuenta).

## Qué hace sola la app

Cada hora (GitHub puede retrasarlo unos minutos):
- Si un partido de El Ventero ha terminado y la FEB ha publicado el acta: guarda el marcador y la
  estadística de cada jugador, y avisa con el resultado, el máximo anotador y la mejor valoración.
- Revisa la fecha, la hora y el pabellón de los 3 próximos partidos; si cambian, avisa.
- Avisa la víspera (a partir de las 20:00) y unas 2 horas antes de cada partido.

## Problemas frecuentes

- **No llegan avisos:** en *Actions → Actualizar datos FEB → Run workflow* marca *Enviar una
  notificación de prueba*. Si falla, revisa el secreto `VAPID_PRIVATE_KEY`.
- **En iPhone no aparece "Activar avisos":** la app debe abrirse desde el icono de la pantalla de inicio.
- **La FEB cambia su web:** si un día dejan de entrar resultados, el registro de *Actions* mostrará
  "todavía sin acta final" o un error; habrá que ajustar `scripts/lib.mjs`.
- **Pruebas locales:** `npm install` y `node scripts/update.mjs`.
