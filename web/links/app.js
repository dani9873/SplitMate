// Página de respaldo de los enlaces de invitación (https://<dominio>/i#<token>).
//
// La abre quien toca el enlace sin tener la app, o desde un navegador que no la abre. El token va en
// el fragmento (#): el navegador no lo envía al servidor ni al Referer, y esta página tampoco lo manda
// a ninguna parte: solo arma el enlace del esquema propio para abrir la app y lo deja copiar.
// Sin analítica, sin recursos de terceros.
(function () {
  'use strict';

  let TOKEN = /^#([A-Za-z0-9_-]{43})$/;

  let TEXTS = {
    es: {
      title: 'Te invitaron a SplitMate',
      lead: 'Abre este enlace en un teléfono que tenga SplitMate para unirte al grupo.',
      open: 'Abrir en SplitMate',
      copy: 'Copiar enlace',
      copied: 'Enlace copiado',
      invalid: 'Este enlace no es válido. Pídele a quien te invitó uno nuevo.',
      note: 'La app todavía no está en las tiendas. Pídele a quien te invitó cómo instalarla.',
    },
    en: {
      title: 'You were invited to SplitMate',
      lead: 'Open this link on a phone that has SplitMate to join the group.',
      open: 'Open in SplitMate',
      copy: 'Copy link',
      copied: 'Link copied',
      invalid: 'This link is not valid. Ask whoever invited you for a new one.',
      note: "The app isn't in the stores yet. Ask whoever invited you how to install it.",
    },
  };

  /** El token del fragmento, o null si no tiene la forma esperada. */
  function tokenFromHash(hash) {
    let match = TOKEN.exec(typeof hash === 'string' ? hash : '');
    return match ? match[1] : null;
  }

  /** Los textos en el idioma del navegador (es o en); en cualquier otro caso, español. */
  function textsFor(language) {
    return /^en(\b|-|_)/i.test(String(language || '')) ? TEXTS.en : TEXTS.es;
  }

  function run(doc, loc, nav) {
    let texts = textsFor(nav && nav.language);
    let byId = function (id) {
      return doc.getElementById(id);
    };
    let set = function (id, text) {
      let element = byId(id);
      if (element) {
        element.textContent = text;
      }
    };
    doc.documentElement.lang = texts === TEXTS.en ? 'en' : 'es';
    set('title', texts.title);
    set('lead', texts.lead);
    set('open', texts.open);
    set('copy', texts.copy);
    set('copied', texts.copied);
    set('invalid', texts.invalid);
    set('note', texts.note);

    let token = tokenFromHash(loc.hash);
    if (!token) {
      byId('invalid').hidden = false;
      return;
    }
    byId('actions').hidden = false;
    byId('open').setAttribute('href', 'splitmate://i#' + token);
    byId('copy').addEventListener('click', function () {
      let done = function () {
        byId('copied').hidden = false;
      };
      if (nav && nav.clipboard && nav.clipboard.writeText) {
        nav.clipboard.writeText(loc.href).then(done, function () {});
      }
    });
  }

  if (typeof document !== 'undefined' && typeof location !== 'undefined') {
    run(document, location, typeof navigator !== 'undefined' ? navigator : null);
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { tokenFromHash: tokenFromHash, textsFor: textsFor, run: run, TEXTS: TEXTS };
  }
})();
