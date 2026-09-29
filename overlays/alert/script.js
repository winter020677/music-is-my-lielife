// アラート用オーバーレイの動き
// 本体から「alert」の知らせが来たら、1つ表示して、決まった時間で消す。
// 次のアラートは、本体が順番に送ってくる（重ならない）。

(function () {
  const stage = document.getElementById('stage');
  const template = document.getElementById('alert-template');
  let current = null;
  let hideTimer = null;

  function removeCurrent(immediately) {
    if (!current) return;
    const el = current;
    current = null;
    clearTimeout(hideTimer);
    if (immediately) {
      el.remove();
      return;
    }
    el.classList.add('leaving');
    el.addEventListener('animationend', function () {
      el.remove();
    });
  }

  function setImage(img, url) {
    if (url) {
      img.src = url;
      img.hidden = false;
    } else {
      img.hidden = true;
    }
  }

  function showAlert(message) {
    removeCurrent(true);
    const el = template.content.firstElementChild.cloneNode(true);
    // 文字は textContent で入れる（名前にHTMLが書かれていても、ただの文字として出る）
    el.querySelector('.alert-title').textContent = message.title || '';
    el.querySelector('.alert-message').textContent = message.message || '';
    setImage(el.querySelector('.alert-avatar'), message.avatarUrl);
    setImage(el.querySelector('.alert-image'), message.imageUrl);
    el.dataset.kind = message.kind || '';
    stage.appendChild(el);
    current = el;
    // 消える動きの分だけ早めに消し始める
    const duration = Math.max(1000, (message.durationMs || 5000) - 400);
    hideTimer = setTimeout(function () {
      removeCurrent(false);
    }, duration);
  }

  connectOverlay('alert', {
    onMessage: function (message) {
      if (message.type === 'alert') showAlert(message);
      if (message.type === 'skip') removeCurrent(false);
    },
  });
})();
