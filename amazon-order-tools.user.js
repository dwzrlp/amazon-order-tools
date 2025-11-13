// ==UserScript==
// @name            Order Tools
// @name:fr         Outils de Commandes
// @name:zh         订单工具
// @description     Modify “Total” amount, hide/show recipient block, and click-to-copy order ID on Amazon orders.
// @description:fr  Modifier le montant « Total », afficher/masquer le bloc destinataire et copier le numéro de commande d’un clic.
// @description:zh  在 Amazon 订单页面修改「Total」金额、隐藏/显示收件信息块，并支持点击复制订单号。
// @namespace       https://github.com/dwzrlp
// @author          Maxwell Voronov
// @version         2.24
// @license         MIT
// @homepageURL     https://github.com/dwzrlp/amazon-order-tools
// @supportURL      https://github.com/dwzrlp/amazon-order-tools/issues
// @icon            https://github.githubassets.com/favicons/favicon.png
// @match           https://www.amazon.co.jp/*
// @match           https://www.amazon.co.uk/*
// @match           https://www.amazon.com/*
// @match           https://www.amazon.com.be/*
// @match           https://www.amazon.com.mx/*
// @match           https://www.amazon.com.tr/*
// @match           https://www.amazon.de/*
// @match           https://www.amazon.es/*
// @match           https://www.amazon.fr/*
// @match           https://www.amazon.it/*
// @match           https://www.amazon.nl/*
// @match           https://www.amazon.se/*
// @match           https://www.amazon.ca/*
// @match           https://www.amazon.in/*
// @match           https://www.amazon.pl/*
// @run-at          document-idle
// @grant           none
// @noframes
// @compatible      chrome Tested on Chrome 120 + Tampermonkey 4.20
// @downloadURL     https://raw.githubusercontent.com/dwzrlp/amazon-order-tools/main/amazon-order-tools.user.js
// @updateURL       https://raw.githubusercontent.com/dwzrlp/amazon-order-tools/main/amazon-order-tools.user.js
// ==/UserScript==

(function () {
  'use strict';

  const NBSP = '\u00A0';
  const normPath = location.pathname.toLowerCase().replace(/^\/-\/*[^/]+/, '');

  // 订单列表页 / 历史 / 详情页 都算
  const isOrdersPage =
    /\/your-orders(\/orders)?/.test(normPath) ||
    /\/gp\/css\/order-history/.test(normPath) ||
    /\/orders(\/)?$/.test(normPath) ||
    /\/order-history/.test(normPath) ||
    /order-details/.test(normPath); // 比如 /gp/your-account/order-details

  if (!isOrdersPage) return;

  // ---------- 多语言：优先使用浏览器语言 ----------

  function detectLang() {
    // 1. 优先浏览器语言（zh-CN / fr-FR / en-US 等）
    let langRaw = (navigator.language || '').toLowerCase();

    // 2. 没有就退回页面 <html lang="">
    if (!langRaw) {
      langRaw = (document.documentElement.lang || '').toLowerCase();
    }

    if (langRaw.startsWith('zh')) return 'zh';
    if (langRaw.startsWith('fr')) return 'fr';
    if (langRaw.startsWith('en')) return 'en';

    // 其它情况直接默认中文
    return 'zh';
  }

  const CURRENT_LANG = detectLang();

  const T = {
    zh: {
      modifyTotal: '修改「Total」金额',
      hideBlock: '隐藏收货信息块',
      showBlock: '显示收货信息块',
      enterPrice: '请输入金额数字（允许逗号或小数点）：',
      okPrice: '已更新最近一单的金额',
      noTotal: '未找到「Total」金额节点',
      okHide: '已隐藏“收件信息块”',
      okShow: '已恢复“收件信息块”',
      invalid: '请输入有效的数字',
      copied: '已复制',
    },
    fr: {
      modifyTotal: 'Modifier le montant “Total”',
      hideBlock: 'Masquer le bloc destinataire',
      showBlock: 'Afficher le bloc destinataire',
      enterPrice: 'Saisissez un montant (chiffres, virgule/point) :',
      okPrice: 'Montant mis à jour',
      noTotal: 'Nœud “Total” introuvable',
      okHide: 'Bloc destinataire masqué',
      okShow: 'Bloc destinataire rétabli',
      invalid: 'Veuillez saisir un nombre valide',
      copied: 'Copié',
    },
    en: {
      modifyTotal: 'Modify “Total” amount',
      hideBlock: 'Hide recipient block',
      showBlock: 'Show recipient block',
      enterPrice: 'Enter amount (digits, comma/dot allowed):',
      okPrice: 'Amount updated',
      noTotal: '“Total” node not found',
      okHide: 'Recipient block hidden',
      okShow: 'Recipient block restored',
      invalid: 'Please enter a valid number',
      copied: 'Copied',
    },
  }[CURRENT_LANG];

  // ---------- 样式 ----------

  const style = document.createElement('style');
  style.textContent = `
.amz-ordertools-bar {
  display:flex;
  flex-wrap:wrap;
  gap:10px;
  align-items:center;
  margin-top:10px;
  margin-bottom:80px !important; /* 这里加大距离 */
}
.amz-ordertools-bar li { list-style:none; }
.amz-toast {
  position:fixed; right:20px; bottom:30px;
  background:#111; color:#fff; padding:10px 14px; border-radius:6px;
  opacity:.95; z-index:2147483647; font-size:13px;
}
.amz-order-copy-tooltip {
  position:absolute;
  background:red;
  color:#fff;
  padding:8px;
  border-radius:8px;
  font-weight:bold;
  z-index:2147483647;
  opacity:0;
  transition:opacity .15s ease-out;
  pointer-events:none;
  font-size:12px;
}
  `;
  document.head.appendChild(style);

  function toast(msg, t = 2000) {
    const d = document.createElement('div');
    d.className = 'amz-toast';
    d.textContent = msg;
    document.body.appendChild(d);
    setTimeout(() => d.remove(), t);
  }

  // ---------- 订单号点击复制 ----------

  // Amazon 订单号格式：123-1234567-1234567
  const ORDER_ID_REGEX = /\d{3}-\d{7}-\d{7}/;

  // 点击目标：
  // - 列表页常见：bdi / span.a-color-secondary
  // - 详情页：data-component="orderId" 里的 span
  const CLICK_TARGET_SELECTOR =
    'bdi, span.a-color-secondary, [data-component="orderId"] span';

  function copyOrderIdFromText(text, element) {
    if (!text) return;
    const match = text.match(ORDER_ID_REGEX);
    if (!match) return;

    const orderId = match[0];

    // 复制到剪贴板
    const textarea = document.createElement('textarea');
    textarea.value = orderId;
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    document.body.removeChild(textarea);

    // 避免多个 tooltip 堆叠
    if (document.querySelector('.amz-order-copy-tooltip')) return;

    const tooltip = document.createElement('div');
    tooltip.className = 'amz-order-copy-tooltip';
    tooltip.textContent = T.copied;
    document.body.appendChild(tooltip);

    const rect = element.getBoundingClientRect();
    const scrollTop =
      window.pageYOffset || document.documentElement.scrollTop || 0;
    const scrollLeft =
      window.pageXOffset || document.documentElement.scrollLeft || 0;

    tooltip.style.top =
      rect.top + scrollTop - tooltip.offsetHeight - 5 + 'px';
    tooltip.style.left = rect.left + scrollLeft + 35 + 'px';

    // 强制 reflow，然后渐显
    void tooltip.offsetWidth;
    tooltip.style.opacity = '1';

    setTimeout(() => {
      tooltip.style.opacity = '0';
      setTimeout(() => tooltip.remove(), 180);
    }, 500);
  }

  function markCopyTargets() {
    const nodes = document.querySelectorAll(CLICK_TARGET_SELECTOR);
    nodes.forEach((el) => {
      if (!el.__amzOrderCopyMarked) {
        el.style.cursor = 'pointer';
        el.__amzOrderCopyMarked = true;
      }
    });
  }

  // 事件委托监听点击
  document.addEventListener('click', function (e) {
    let el = e.target;
    while (el && el !== document) {
      if (el.matches && el.matches(CLICK_TARGET_SELECTOR)) {
        const text = (el.textContent || '').trim();
        copyOrderIdFromText(text, el);
        break;
      }
      el = el.parentElement;
    }
  });

  // ---------- 原有“修改 Total / 隐藏收件信息块”逻辑 ----------

  const ORDER_CARD_SELECTORS = [
    '[data-test-id="order-card"]',
    '#ordersContainer .order-card',
    '.your-orders-content .a-box-group',
    '#a-page .a-box-group',
    '#ordersContainer .order',
  ];

  function getAllOrderCards() {
    for (const sel of ORDER_CARD_SELECTORS) {
      const list = document.querySelectorAll(sel);
      if (list.length)
        return Array.from(list).filter((el) => el.offsetParent !== null);
    }
    return [];
  }

  function latestCard() {
    const list = getAllOrderCards();
    return list.length ? list[0] : null;
  }

  function findTotalSpan(card) {
    if (!card) return null;
    const lis = card.querySelectorAll('li.order-header__header-list-item');
    for (const li of lis) {
      const titleNode = li.querySelector(
        '.a-row.a-size-mini .a-text-caps, .a-text-caps, .a-color-secondary'
      );
      if (!titleNode) continue;
      const titleText = (titleNode.textContent || '').trim().toLowerCase();
      if (!/total/.test(titleText)) continue;
      const titleRow = titleNode.closest('.a-row') || titleNode.parentElement;
      const amountRow = titleRow ? titleRow.nextElementSibling : null;
      if (amountRow) {
        const strict = amountRow.querySelector(
          'span.a-size-base.a-color-secondary.aok-break-word'
        );
        if (strict) return strict;
        const fallback = amountRow.querySelector(
          'span.a-offscreen, span.a-size-base, span.a-color-base, span.a-color-secondary'
        );
        if (fallback) return fallback;
      }
    }
    return null;
  }

  function formatLikeSample(sampleText, inputNumberString) {
    const numberBlockRegex = /[-+]?[\d\s.,'’´` \u00A0\u202F]+/;
    const m = sampleText.match(numberBlockRegex);
    if (m) {
      const before = sampleText.slice(0, m.index);
      const after = sampleText.slice(m.index + m[0].length);
      return before + inputNumberString + after;
    }
    return inputNumberString + NBSP + '€';
  }

  function setTotalAmountSmart(newNumericString) {
    const card = latestCard();
    if (!card) return false;
    const span = findTotalSpan(card);
    if (!span) return false;
    if (!span.dataset._orig) span.dataset._orig = span.textContent;
    span.textContent = formatLikeSample(span.textContent || '', newNumericString);
    return true;
  }

  function hideRecipientBlock() {
    const card = latestCard();
    if (!card) return false;
    const recipient =
      card.querySelector('.yohtmlc-recipient') ||
      card.querySelector('[id^="shipToInsertionNode-"][id*="shippingAddress-"]');
    if (recipient) {
      const block =
        recipient.closest('li.order-header__header-list-item') ||
        recipient.closest('.a-column') ||
        recipient;
      if (block) {
        if (!block.dataset._origDisplay)
          block.dataset._origDisplay = block.style.display || '';
        block.style.display = 'none';
        return true;
      }
    }
    return false;
  }

  function restoreRecipientBlock() {
    const card = latestCard();
    if (!card) return false;
    let ok = false;
    card
      .querySelectorAll(
        'li.order-header__header-list-item, .a-column, .yohtmlc-recipient, [id^="shipToInsertionNode-"][id*="shippingAddress-"]'
      )
      .forEach((el) => {
        if (el.dataset && el.dataset._origDisplay !== undefined) {
          el.style.display = el.dataset._origDisplay || '';
          delete el.dataset._origDisplay;
          ok = true;
        }
      });
    return ok;
  }

  function createPrimaryButton(label, action) {
    const outer = document.createElement('span');
    outer.className =
      'a-button a-button-normal a-spacing-mini a-button-primary';
    const inner = document.createElement('span');
    inner.className = 'a-button-inner';
    const a = document.createElement('a');
    a.href = 'javascript:void(0)';
    a.className = 'a-button-text';
    a.setAttribute('role', 'button');
    a.textContent = label;
    a.addEventListener('click', (e) => {
      e.preventDefault();
      action && action();
    });
    inner.appendChild(a);
    outer.appendChild(inner);
    const li = document.createElement('li');
    li.appendChild(outer);
    return li;
  }

  function ensureToolbar() {
    if (document.querySelector('.amz-ordertools-bar')) return false;
    const f = document.querySelector(
      'div.a-row.a-spacing-base form.js-time-filter-form'
    );
    if (!f) return false;
    const row = f.closest('div.a-row.a-spacing-base');
    if (!row || !row.parentNode) return false;

    const bar = document.createElement('ul');
    bar.className = 'amz-ordertools-bar a-unordered-list a-nostyle a-horizontal';

    const btnEdit = createPrimaryButton(T.modifyTotal, () => {
      const span = findTotalSpan(latestCard());
      const m = span?.textContent.match(/[\d\s.,'’´` \u00A0\u202F]+/);
      const defVal = m
        ? m[0].replace(/[^\d.,]/g, '').trim()
        : '';
      let v = prompt(
        T.enterPrice,
        sessionStorage.getItem('amz_total_override_latest') || defVal || ''
      );
      if (v === null) return;
      v = v.trim();
      if (!/^[\d\s.,]+$/.test(v)) {
        toast(T.invalid);
        return;
      }
      v = v.replace(/\s+/g, '');
      if (setTotalAmountSmart(v)) {
        sessionStorage.setItem('amz_total_override_latest', v);
        toast(T.okPrice);
      } else {
        toast(T.noTotal);
      }
    });

    const hidden =
      sessionStorage.getItem('amz_hide_recipient_block_latest') === 'true';
    const btnHide = createPrimaryButton(
      hidden ? T.showBlock : T.hideBlock,
      () => {
        const nowHidden =
          sessionStorage.getItem('amz_hide_recipient_block_latest') === 'true';
        if (!nowHidden) {
          hideRecipientBlock();
          sessionStorage.setItem('amz_hide_recipient_block_latest', 'true');
          btnHide.querySelector('.a-button-text').textContent = T.showBlock;
          toast(T.okHide);
        } else {
          restoreRecipientBlock();
          sessionStorage.setItem('amz_hide_recipient_block_latest', 'false');
          btnHide.querySelector('.a-button-text').textContent = T.hideBlock;
          toast(T.okShow);
        }
      }
    );

    bar.appendChild(btnEdit);
    bar.appendChild(btnHide);

    row.parentNode.insertBefore(bar, row.nextSibling);
    return true;
  }

  function applyPersisted() {
    try {
      const v = sessionStorage.getItem('amz_total_override_latest');
      if (v) setTotalAmountSmart(v);
      if (
        sessionStorage.getItem('amz_hide_recipient_block_latest') === 'true'
      ) {
        hideRecipientBlock();
      }
    } catch (_) {}
  }

  // ---------- 初始化 ----------

  ensureToolbar();
  setTimeout(() => {
    applyPersisted();
    markCopyTargets();
  }, 500);

  let lastOrderCount = getAllOrderCards().length;
  let throttleTimer = null;
  const ob = new MutationObserver(() => {
    if (throttleTimer) return;
    throttleTimer = setTimeout(() => {
      throttleTimer = null;
      const nowCount = getAllOrderCards().length;
      const needBar = !document.querySelector('.amz-ordertools-bar');
      if (needBar) ensureToolbar();
      if (needBar || nowCount !== lastOrderCount) {
        applyPersisted();
        lastOrderCount = nowCount;
      }
      // DOM 变化时顺便再标记一次可复制订单号
      markCopyTargets();
    }, 800);
  });
  ob.observe(document.body, { childList: true, subtree: true });
})();
