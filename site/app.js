// Demo page for elementalfx. Uses the <script> builds: window.ElementalFX.*
(() => {
  const { ripples, weather, fluid, gravity, dissolve } = window.ElementalFX;
  const $ = (selector) => document.querySelector(selector);

  // Reduced motion: the effects stay still on their own; say so once.
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  const showReduced = () => ($('#reduced').hidden = !motion.matches);
  showReduced();
  motion.addEventListener('change', showReduced);

  // Code samples, lightly colored.
  function highlight(source) {
    const escaped = source.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return escaped.replace(
      /(\/\/[^\n]*)|('(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*")|\b(import|from|export|function|return|const|await)\b/g,
      (match, comment, string, keyword) => {
        if (comment) return `<span class="c">${comment}</span>`;
        if (string) return `<span class="s">${string}</span>`;
        return keyword ? `<span class="k">${keyword}</span>` : match;
      },
    );
  }
  const code = (id, source) => ($(id).innerHTML = highlight(source.trim()));

  // Copy buttons.
  for (const button of document.querySelectorAll('[data-copy]')) {
    button.addEventListener('click', async () => {
      const text = $(button.dataset.copy).textContent;
      try {
        await navigator.clipboard.writeText(text);
        button.textContent = 'Copied';
      } catch {
        getSelection().selectAllChildren($(button.dataset.copy));
        button.textContent = 'Selected';
      }
      setTimeout(() => (button.textContent = 'Copy'), 1600);
    });
  }

  // Preset buttons: one pressed at a time per group.
  function choices(group, onChange) {
    const buttons = [...document.querySelectorAll(`[data-group="${group}"] button`)];
    for (const button of buttons) {
      button.addEventListener('click', () => {
        for (const other of buttons) other.setAttribute('aria-pressed', String(other === button));
        onChange(button.dataset.value);
      });
    }
  }

  // Hero: snow settles on the letters once the display font is in.
  const wordmark = $('#wordmark span');
  wordmark.innerHTML = [...wordmark.textContent].map((letter) => `<span class="letter">${letter}</span>`).join('');
  document.fonts.ready.then(() => {
    weather.createWeather('#hero', {
      preset: 'snow',
      snow: { density: 0.9 },
      settleOn: '#wordmark .letter',
      maxSnowDepth: 16,
    });
  });

  // Ripples on a painted lake at dusk.
  function paintLake() {
    const canvas = document.createElement('canvas');
    canvas.width = 1600;
    canvas.height = 800;
    const ctx = canvas.getContext('2d');
    const horizon = 430;
    const sky = ctx.createLinearGradient(0, 0, 0, horizon);
    sky.addColorStop(0, '#0f2236');
    sky.addColorStop(0.55, '#3d4d7a');
    sky.addColorStop(0.85, '#c7798a');
    sky.addColorStop(1, '#f2b37a');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, 1600, horizon);
    for (let i = 0; i < 140; i++) {
      ctx.fillStyle = `rgba(255,255,255,${0.2 + Math.random() * 0.6})`;
      ctx.fillRect(Math.random() * 1600, Math.random() * horizon * 0.5, 1.6, 1.6);
    }
    const sun = ctx.createRadialGradient(1080, horizon - 40, 0, 1080, horizon - 40, 260);
    sun.addColorStop(0, 'rgba(255,236,190,1)');
    sun.addColorStop(0.12, 'rgba(255,214,150,0.9)');
    sun.addColorStop(1, 'rgba(255,180,120,0)');
    ctx.fillStyle = sun;
    ctx.fillRect(700, 0, 800, horizon);
    const ridge = (color, base, height, seed) => {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(0, horizon);
      for (let x = 0; x <= 1600; x += 20) {
        const y = base - height * (0.5 + 0.5 * Math.sin(x / 170 + seed) * Math.cos(x / 61 + seed * 2));
        ctx.lineTo(x, Math.min(horizon, y));
      }
      ctx.lineTo(1600, horizon);
      ctx.fill();
    };
    ridge('#5b4f78', horizon - 30, 120, 1.3);
    ridge('#2e3150', horizon - 6, 90, 4.1);
    ridge('#161b2e', horizon, 46, 7.7);
    // The lake mirrors the sky, darker toward the shore.
    ctx.save();
    ctx.translate(0, horizon * 2);
    ctx.scale(1, -1);
    ctx.globalAlpha = 0.75;
    ctx.drawImage(canvas, 0, 0, 1600, horizon, 0, 0, 1600, horizon);
    ctx.restore();
    const water = ctx.createLinearGradient(0, horizon, 0, 800);
    water.addColorStop(0, 'rgba(10,20,40,0.15)');
    water.addColorStop(1, 'rgba(6,14,28,0.85)');
    ctx.fillStyle = water;
    ctx.fillRect(0, horizon, 1600, 800 - horizon);
    ctx.fillStyle = 'rgba(255,220,170,0.35)';
    for (let i = 0; i < 26; i++) {
      const y = horizon + 14 + i * 11;
      const width = 300 - i * 9;
      ctx.fillRect(1080 - width / 2 + Math.sin(i) * 20, y, width, 2);
    }
    return canvas.toDataURL('image/jpeg', 0.9);
  }

  const lake = $('#ripples-demo');
  lake.style.backgroundImage = `url(${paintLake()})`;
  let lakeEffect = null;
  let lakeSky = null;
  let lakePreset = 'pond';
  function startLake() {
    lakeSky?.destroy();
    lakeSky = null;
    lakeEffect?.destroy();
    lakeEffect = ripples.createRipples(lake, { preset: lakePreset });
    const raining = $('#ripples-sky').checked;
    if (raining) lakeSky = weather.createWeather(lake, { preset: 'rain', rain: { density: 0.35 }, ripples: [lakeEffect] });
    code(
      '#ripples-code',
      raining
        ? `import { createRipples } from '@elementalfx/ripples';
import { createWeather } from '@elementalfx/weather';

const lake = createRipples('.lake', { preset: '${lakePreset}' });
// Raindrops make ripples where they land.
createWeather('.lake', { preset: 'rain', ripples: [lake] });`
        : `import { createRipples } from '@elementalfx/ripples';

createRipples('.lake', { preset: '${lakePreset}' });

// or, with no build step:
// <fx-ripples preset="${lakePreset}"><img src="lake.jpg" alt=""></fx-ripples>`,
    );
  }
  choices('ripples', (value) => {
    lakePreset = value;
    startLake();
  });
  $('#ripples-sky').addEventListener('change', startLake);
  startLake();

  // Weather over a night town.
  let townWeather = null;
  function startTown(preset) {
    townWeather?.destroy();
    townWeather = weather.createWeather('#weather-demo', { preset, settleOn: '#weather-demo .roof' });
    code(
      '#weather-code',
      `import { createWeather } from '@elementalfx/weather';

createWeather('.town', {
  preset: '${preset}',
  settleOn: '.roof', // snow piles up on these
});

// or: <fx-weather preset="${preset}" settle-on=".roof"></fx-weather>`,
    );
  }
  choices('weather', startTown);
  startTown('snow');

  // Fluid.
  let pool = null;
  function startFluid(preset) {
    pool?.destroy();
    pool = fluid.createFluid('#fluid-demo', { preset });
    code(
      '#fluid-code',
      `import { createFluid } from '@elementalfx/fluid';

const fluid = createFluid('.hero', { preset: '${preset}' });
fluid.burst(8); // a few splashes from code

// A smoke trail over the whole page instead:
createFluid(document.body, { preset: 'smoke' });`,
    );
  }
  choices('fluid', startFluid);
  $('#fluid-splash').addEventListener('click', () => pool?.burst(8));
  startFluid('ink');

  // Gravity in the box, and on the whole page with the Konami code.
  // The box is the whole room, so everything in it falls, even if it's scrolled out of view.
  const box = gravity.createGravity('#gravity-demo', { restoreDuration: 0.8, onlyVisible: false });
  $('#gravity-drop').addEventListener('click', () => box.drop());
  $('#gravity-explode').addEventListener('click', () => box.explode());
  $('#gravity-restore').addEventListener('click', () => box.restore());
  $('#gravity-demo').setAttribute('data-gravity', 'ignore');
  gravity.createGravity(document.body, { trigger: 'konami' });
  code(
    '#gravity-code',
    `import { createGravity } from '@elementalfx/gravity';

const gravity = createGravity('.shop');
gravity.drop();     // let it fall
gravity.explode();  // blow it apart
gravity.restore();  // fly it back

// The whole page, on the Konami code:
createGravity(document.body, { trigger: 'konami' });`,
  );

  // Dissolve: each card vanishes its own way, then comes back.
  const showDissolve = (effect) =>
    code(
      '#dissolve-code',
      `import { dissolve, assemble } from '@elementalfx/dissolve';

await dissolve(card, { effect: '${effect}' });
await assemble(card, { effect: '${effect}' });`,
    );
  for (const card of document.querySelectorAll('.specimen')) {
    card.addEventListener('click', async () => {
      if (card.dataset.busy) return;
      card.dataset.busy = 'true';
      const effect = card.dataset.effect;
      showDissolve(effect);
      await dissolve.dissolve(card, { effect });
      await new Promise((resolve) => setTimeout(resolve, 700));
      await dissolve.assemble(card, { effect });
      delete card.dataset.busy;
    });
  }
  showDissolve('dust');

  code(
    '#react-code',
    `import { Weather } from '@elementalfx/react/weather';
import { Dissolve } from '@elementalfx/react/dissolve';

export function Page({ open }) {
  return (
    <>
      <Weather page options={{ preset: 'snow' }} />
      <Dissolve show={open} options={{ effect: 'dust' }}>
        <Card />
      </Dissolve>
    </>
  );
}`,
  );
})();
