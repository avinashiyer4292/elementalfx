# @elementalfx/react

React components and hooks for every elementalfx effect: `<Ripples>`, `<Weather>`, `<Fluid>`, `<Gravity>` and `<Dissolve>`.

Each effect has its own entry point, so you install only the effect packages you use. Everything renders on the server, and effects start in the browser after mount.

## Install

Install this package along with the effects you want:

```sh
npm install @elementalfx/react @elementalfx/weather @elementalfx/dissolve
```

Works with React 18 and 19.

## Components

Every component renders a `div`, or any element you pass with `as`. Its effect runs on that element. Changing `options` updates the running effect instead of restarting it. Any other prop, such as `className`, `style` or `id`, goes to the element.

```tsx
import { Ripples } from '@elementalfx/react/ripples';
import { Weather } from '@elementalfx/react/weather';
import { Fluid } from '@elementalfx/react/fluid';

export function Hero() {
  return (
    <Ripples className="hero" options={{ preset: 'rain' }}>
      <h1>Rainy day</h1>
    </Ripples>
  );
}

// `page` covers the whole page instead of a wrapper; children render with no wrapper.
<Weather page options={{ preset: 'snow' }} />
<Fluid page options={{ preset: 'smoke' }} />

// Ripples on an image
<Ripples as="img" src="/lake.jpg" alt="A lake at dusk" options={{ interactive: true }} />
```

`onReady` hands you the running effect:

```tsx
import { Gravity } from '@elementalfx/react/gravity';

function NotFound() {
  const [gravity, setGravity] = useState(null);
  return (
    <Gravity page onReady={setGravity}>
      <h1>404</h1>
      <p>This page fell apart.</p>
      <button onClick={() => gravity?.drop()}>Drop it</button>
    </Gravity>
  );
}
```

### Dissolve

`<Dissolve>` animates its children out when `show` turns off and back in when it turns on. Content that starts with `show` off is hidden from the first frame.

```tsx
import { Dissolve } from '@elementalfx/react/dissolve';

<Dissolve show={open} options={{ effect: 'burn' }} onDone={(shown) => console.log(shown)}>
  <Card />
</Dissolve>
```

The element keeps its space while hidden, since React owns it; `after: 'remove'` isn't available here. To take it out of the layout, unmount it in `onDone`.

## Hooks

For your own elements, each hook returns a `ref` to attach and the running `instance`:

```tsx
import { useWeather } from '@elementalfx/react/weather';
import { useDissolve } from '@elementalfx/react/dissolve';

function Banner() {
  const { ref, instance } = useWeather<HTMLDivElement>({ preset: 'storm' });
  return <div ref={ref} className="banner" onClick={() => instance?.strike()} />;
}

function Toast() {
  const { ref, dissolve } = useDissolve<HTMLDivElement>({ effect: 'dust' });
  return <div ref={ref} onClick={() => dissolve()}>Saved!</div>;
}
```

| Entry point | Component | Hook |
| --- | --- | --- |
| `@elementalfx/react/ripples` | `Ripples` | `useRipples(options, page?)` |
| `@elementalfx/react/weather` | `Weather` | `useWeather(options, page?)` |
| `@elementalfx/react/fluid` | `Fluid` | `useFluid(options, page?)` |
| `@elementalfx/react/gravity` | `Gravity` | `useGravity(options, page?)` |
| `@elementalfx/react/dissolve` | `Dissolve` | `useDissolve(defaults)` |

The root entry, `@elementalfx/react`, exports `useElementalEffect` and `effectComponent`, which are what the components are built from, if you want to wrap an effect of your own.

Each effect's options are documented in its own package README.

MIT License
