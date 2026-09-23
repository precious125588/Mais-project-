// Provider chains.
//
// audioChain  : ordered fallback for ".play" / ".song" / "Audio" buttons.
//               Full-length sources first, previews last, so the bot always
//               sends *something* instead of "no valid audio file url".
// videoChain  : ordered fallback for ".video" / ".mp4".
const audius = require('./audius');
const jamendo = require('./jamendo');
const deezer = require('./deezer');
const itunes = require('./itunes');
const youtube = require('./youtube');

module.exports = {
  audius,
  jamendo,
  deezer,
  itunes,
  youtube,
  // Full-length first, then legal previews as a guaranteed last resort.
  audioChain: [audius, jamendo, deezer, itunes],
  // Video: Piped stream extraction first, then metadata-only link.
  videoChain: [
    {
      name: 'piped-video',
      searchTrack: async (query) => {
        const meta = await youtube.searchVideo(query);
        return youtube.resolveStream(meta.videoId, { audioOnly: false });
      },
    },
    {
      name: 'youtube-link',
      searchTrack: async (query) => {
        const meta = await youtube.searchVideo(query);
        return { ...meta, linkOnly: true };
      },
    },
  ],
};
