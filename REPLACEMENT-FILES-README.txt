MIAS replacement files
======================

These replacement files address the Naruto hashtag fetch and TikTok picker:

1. `.Naruto` and its aliases search only the supplied Naruto TikTok hashtag
   allow-list, shuffle candidates, resolve them through TikWM with HD enabled,
   and send exactly two random edits. Videos are normalized to a stable 720p
   MP4 when ffmpeg is available.
2. TikTok format selection uses a native WhatsApp single-select/radio menu.
   Typed replies such as `1.3`, `.1.3`, `2.1`, and button/native-flow replies
   use the same picker handler. Picker state survives linked-device JID
   changes, and TikWM URLs are refreshed before a valid choice is rejected.

Copy these paths over the matching paths in the project:

  mias/index.js
  mias/features/animeEdits.js
  mias/features/tiktok.js

Do not copy `.env`, auth folders, session folders, node_modules, or generated
package-lock files from the development workspace.