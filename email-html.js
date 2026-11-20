import sanitizeHtml from 'sanitize-html';

const COLOR_SOURCE = String.raw`(?:#[\da-f]{3,4}|#[\da-f]{6}|#[\da-f]{8}|(?:rgba?|hsla?)\([\d.%\s,+/-]+\)|[a-z]{1,24})`;
const LENGTH_SOURCE = String.raw`(?:0|(?:[0-9]{1,3}(?:\.[0-9]{1,2})?)(?:px|pt|em|rem)|(?:100|[0-9]{1,2}(?:\.[0-9]{1,2})?)%)`;
const BORDER_WIDTH_SOURCE = String.raw`(?:thin|medium|thick|0|(?:[0-9]{1,2}(?:\.[0-9]{1,2})?)(?:px|pt|em|rem))`;
const BORDER_STYLE_SOURCE = String.raw`(?:none|hidden|solid|dashed|dotted|double|groove|ridge|inset|outset)`;
const BORDER_SOURCE = String.raw`(?:none|(?:(?:${BORDER_WIDTH_SOURCE}\s+)?${BORDER_STYLE_SOURCE}(?:\s+${COLOR_SOURCE})?|${COLOR_SOURCE}\s+(?:${BORDER_WIDTH_SOURCE}\s+)?${BORDER_STYLE_SOURCE}))`;
const FONT_FAMILY_NAME_SOURCE = String.raw`(?:"[a-z][a-z0-9 _.-]{0,47}"|'[a-z][a-z0-9 _.-]{0,47}'|-?[a-z][a-z0-9 _.-]{0,47})`;
const oneToFour = (source) => new RegExp(`^${source}(?:\\s+${source}){0,3}$`, 'i');
const lengthList = oneToFour(LENGTH_SOURCE);
const marginList = oneToFour(String.raw`(?:${LENGTH_SOURCE}|auto)`);
const colorList = oneToFour(COLOR_SOURCE);
const borderWidthList = oneToFour(BORDER_WIDTH_SOURCE);
const borderStyleList = oneToFour(BORDER_STYLE_SOURCE);
const borderRadius = new RegExp(`^${LENGTH_SOURCE}(?:\\s+${LENGTH_SOURCE}){0,3}(?:\\s*\\/\\s*${LENGTH_SOURCE}(?:\\s+${LENGTH_SOURCE}){0,3})?$`, 'i');
const borderSpacing = new RegExp(`^${LENGTH_SOURCE}(?:\\s+${LENGTH_SOURCE})?$`, 'i');
const dimension = new RegExp(`^(?:auto|${LENGTH_SOURCE})$`, 'i');
const fontFamily = new RegExp(`^${FONT_FAMILY_NAME_SOURCE}(?:\\s*,\\s*${FONT_FAMILY_NAME_SOURCE}){0,4}$`, 'i');
const fontSize = new RegExp(`^(?:xx-small|x-small|small|medium|large|x-large|xx-large|smaller|larger|[0-9]{1,2}(?:\\.[0-9]{1,2})?(?:px|pt|em|rem)|(?:100|[0-9]{1,2}(?:\\.[0-9]{1,2})?)%)$`, 'i');
const lineHeight = /^(?:normal|[0-9]{1,2}(?:\.[0-9]{1,2})?(?:px|pt|em|rem|%)?)$/i;
const safeStyles = {
  'background-color': [new RegExp(`^${COLOR_SOURCE}$`, 'i')],
  'border': [new RegExp(`^${BORDER_SOURCE}$`, 'i')],
  'border-bottom': [new RegExp(`^${BORDER_SOURCE}$`, 'i')],
  'border-bottom-color': [colorList],
  'border-bottom-style': [borderStyleList],
  'border-bottom-width': [borderWidthList],
  'border-collapse': [/^(?:collapse|separate)$/i],
  'border-color': [colorList],
  'border-left': [new RegExp(`^${BORDER_SOURCE}$`, 'i')],
  'border-left-color': [colorList],
  'border-left-style': [borderStyleList],
  'border-left-width': [borderWidthList],
  'border-radius': [borderRadius],
  'border-right': [new RegExp(`^${BORDER_SOURCE}$`, 'i')],
  'border-right-color': [colorList],
  'border-right-style': [borderStyleList],
  'border-right-width': [borderWidthList],
  'border-spacing': [borderSpacing],
  'border-style': [borderStyleList],
  'border-top': [new RegExp(`^${BORDER_SOURCE}$`, 'i')],
  'border-top-color': [colorList],
  'border-top-style': [borderStyleList],
  'border-top-width': [borderWidthList],
  'border-width': [borderWidthList],
  'box-sizing': [/^(?:border-box|content-box)$/i],
  'color': [new RegExp(`^${COLOR_SOURCE}$`, 'i')],
  'direction': [/^(?:ltr|rtl)$/i],
  'display': [/^(?:block|inline|inline-block|table|table-row|table-cell|table-row-group|table-header-group|table-footer-group|table-caption|list-item)$/i],
  'font-family': [fontFamily],
  'font-size': [fontSize],
  'font-style': [/^(?:normal|italic|oblique)$/i],
  'font-variant': [/^(?:normal|small-caps)$/i],
  'font-weight': [/^(?:normal|bold|bolder|lighter|[1-9]00)$/i],
  'height': [dimension],
  'letter-spacing': [new RegExp(`^${LENGTH_SOURCE}$`, 'i')],
  'line-height': [lineHeight],
  'list-style-type': [/^(?:none|disc|circle|square|decimal|decimal-leading-zero|lower-alpha|upper-alpha|lower-roman|upper-roman)$/i],
  'margin': [marginList],
  'margin-bottom': [new RegExp(`^(?:auto|${LENGTH_SOURCE})$`, 'i')],
  'margin-left': [new RegExp(`^(?:auto|${LENGTH_SOURCE})$`, 'i')],
  'margin-right': [new RegExp(`^(?:auto|${LENGTH_SOURCE})$`, 'i')],
  'margin-top': [new RegExp(`^(?:auto|${LENGTH_SOURCE})$`, 'i')],
  'max-height': [new RegExp(`^${LENGTH_SOURCE}$`, 'i')],
  'max-width': [new RegExp(`^${LENGTH_SOURCE}$`, 'i')],
  'min-height': [new RegExp(`^${LENGTH_SOURCE}$`, 'i')],
  'min-width': [new RegExp(`^${LENGTH_SOURCE}$`, 'i')],
  'padding': [lengthList],
  'padding-bottom': [new RegExp(`^${LENGTH_SOURCE}$`, 'i')],
  'padding-left': [new RegExp(`^${LENGTH_SOURCE}$`, 'i')],
  'padding-right': [new RegExp(`^${LENGTH_SOURCE}$`, 'i')],
  'padding-top': [new RegExp(`^${LENGTH_SOURCE}$`, 'i')],
  'table-layout': [/^(?:auto|fixed)$/i],
  'text-align': [/^(?:left|right|center|justify|start|end)$/i],
  'text-decoration': [/^(?:none|underline|overline|line-through)$/i],
  'text-transform': [/^(?:none|capitalize|uppercase|lowercase)$/i],
  'vertical-align': [/^(?:baseline|top|middle|bottom|sub|super|text-top|text-bottom)$/i],
  'white-space': [/^(?:normal|pre|pre-wrap)$/i],
  'width': [dimension],
  'word-break': [/^(?:normal|break-all|keep-all)$/i],
  'overflow-wrap': [/^(?:normal|break-word|anywhere)$/i]
};

export function normalizeContentId(value) {
  let contentId = String(value || '').trim().replace(/^cid:/i, '').replace(/^<|>$/g, '').trim();
  try { contentId = decodeURIComponent(contentId); } catch {}
  return contentId.toLowerCase();
}

export function sanitizeEmailHtml(input, inlineImages = new Map()) {
  return sanitizeHtml(String(input || ''), {
    allowedTags: ['a','p','br','div','span','b','strong','i','em','u','s','blockquote','ul','ol','li','table','thead','tbody','tr','td','th','h1','h2','h3','h4','pre','code','hr','font','img','body'],
    allowedAttributes: {
      '*': ['style'],
      a: ['href','title','target','rel'],
      td: ['colspan','rowspan'],
      th: ['colspan','rowspan'],
      font: ['color','size','face'],
      img: ['src','alt','title','width','height','data-external-src','data-cid-src']
    },
    allowedStyles: { '*': safeStyles },
    allowedSchemes: ['http','https','mailto'],
    allowedSchemesByTag: { img: ['data'] },
    allowProtocolRelative: false,
    disallowedTagsMode: 'discard',
    transformTags: {
      body: (_tagName, attributes) => ({ tagName: 'div', attribs: attributes }),
      a: (_tagName, attributes) => ({ tagName: 'a', attribs: { ...attributes, target: '_blank', rel: 'noopener noreferrer' } }),
      img: (_tagName, attributes) => {
        const safeAttributes = { ...attributes };
        const source = String(safeAttributes.src || '').trim();
        delete safeAttributes['data-external-src'];
        if (/^cid:/i.test(source)) {
          const inlineSource = inlineImages.get(normalizeContentId(source));
          if (inlineSource) {
            safeAttributes.src = inlineSource;
          } else {
            // cid 引用超出内联预算（>2MB/张或>6MB 总量）或缺 content：
            // 保留标记，由客户端从附件端点按 disposition=inline 取回后回填，避免正文空白
            delete safeAttributes.src;
            safeAttributes['data-cid-src'] = source;
          }
        } else if (/^https?:\/\//i.test(source)) {
          safeAttributes['data-external-src'] = source;
          delete safeAttributes.src;
        } else delete safeAttributes.src;
        return { tagName: 'img', attribs: safeAttributes };
      }
    }
  });
}
