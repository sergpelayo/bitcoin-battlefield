# Música de fondo

Deja aquí tu pista (mp3, ogg o m4a) y cárgala desde el panel **♪ AUDIO** de la
app escribiendo la ruta relativa, por ejemplo:

    audio/mi-pista.mp3

Todo lo que hay en `public/` se sirve tal cual desde la raíz del sitio, así que
`public/audio/mi-pista.mp3` se pide como `audio/mi-pista.mp3`. Se guarda en el
navegador, de modo que sólo hay que indicarla una vez.

Las explosiones y la sirena NO son ficheros: se sintetizan con WebAudio en
`src/audio.js`, así que no hay nada más que descargar aquí.
