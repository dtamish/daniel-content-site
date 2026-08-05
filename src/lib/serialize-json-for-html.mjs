const HTML_UNSAFE_CHARACTERS = /[<>&\u2028\u2029]/g;

const ESCAPES = {
  '<': '\\u003c',
  '>': '\\u003e',
  '&': '\\u0026',
  '\u2028': '\\u2028',
  '\u2029': '\\u2029',
};

/**
 * Serialize structured data for an inline application/ld+json element.
 * Escaping HTML-significant characters prevents a CMS value from closing
 * the script element while preserving the original value after JSON.parse.
 *
 * @param {unknown} value
 */
export function serializeJsonForHtml(value) {
  return JSON.stringify(value).replace(
    HTML_UNSAFE_CHARACTERS,
    (character) => ESCAPES[character],
  );
}
