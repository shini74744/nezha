// @ts-nocheck
// Migrated source for the built-in stars feature; resources are owned by FeatureScope.
export function stars(scope, config) {
const window = scope.window; const document = scope.document;
if (!document.querySelector(".js-cursor-container")) {
  const container = scope.createElement("span");
  container.className = "js-cursor-container";
  scope.appendMany(document.body, container);
}
(function fairyDustCursor() {
  var possibleColors = ["#D61C59", "#E7D84B", "#1B8798"];
  var width = window.innerWidth;
  var height = window.innerHeight;
  var cursor = {
    x: width / 2,
    y: width / 2
  };
  var particles = [];
  function init() {
    bindEvents();
    loop();
  }
  function bindEvents() {
    scope.listen(document, 'mousemove', onMouseMove);
    scope.listen(window, 'resize', onWindowResize);
  }
  function onWindowResize(e) {
    width = window.innerWidth;
    height = window.innerHeight;
  }
  function onMouseMove(e) {
    cursor.x = e.clientX;
    cursor.y = e.clientY;
    addParticle(cursor.x, cursor.y, possibleColors[Math.floor(Math.random() * possibleColors.length)]);
  }
  function addParticle(x, y, color) {
    var particle = new Particle();
    particle.init(x, y, color);
    particles.push(particle);
  }
  function updateParticles() {
    for (var i = 0; i < particles.length; i++) {
      particles[i].update();
    }
    for (var i = particles.length - 1; i >= 0; i--) {
      if (particles[i].lifeSpan < 0) {
        particles[i].die();
        particles.splice(i, 1);
      }
    }
  }
  function loop() {
    scope.requestAnimationFrame(loop);
    updateParticles();
  }
  function Particle() {
    this.character = "*";
    this.lifeSpan = 120;
    this.initialStyles = {
      "position": "fixed",
      "display": "inline-block",
      "top": "0px",
      "left": "0px",
      "pointerEvents": "none",
      "touch-action": "none",
      "z-index": "10000000",
      "fontSize": "25px",
      "will-change": "transform"
    };
    this.init = function (x, y, color) {
      this.velocity = {
        x: (Math.random() < 0.5 ? -1 : 1) * (Math.random() / 2),
        y: 1
      };
      this.position = {
        x: x + 10,
        y: y + 10
      };
      this.initialStyles.color = color;
      this.element = scope.createElement('span');
      this.element.innerHTML = this.character;
      applyProperties(this.element, this.initialStyles);
      this.update();
      scope.append(document.querySelector('.js-cursor-container'), this.element);
    };
    this.update = function () {
      this.position.x += this.velocity.x;
      this.position.y += this.velocity.y;
      this.lifeSpan--;
      scope.styleOf(this.element).transform = "translate3d(" + this.position.x + "px," + this.position.y + "px, 0) scale(" + this.lifeSpan / 120 + ")";
    };
    this.die = function () {
      scope.detach(this.element.parentNode, this.element);
    };
  }
  function applyProperties(target, properties) {
    for (var key in properties) {
      scope.styleOf(target)[key] = properties[key];
    }
  }
  if (!('ontouchstart' in window || navigator.msMaxTouchPoints)) init();
})();
}
