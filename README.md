# Open Source Bonk

<img alt="Logo" src="resources/source/graphics/tt/bonkgameicon3.png" width="140"/>

A reimplementation of [Bonk.io](https://bonk.io) that you run yourself.

> [!WARNING]
> **This is beta software.** It is not representative of a finished build. Expect bugs and
> expect things that aren't there yet.
>
> There's no update mechanism. If you want to stay current, fork it, get a git client, and
> pull when there's a major update. Those can change how things work, and keeping your own
> server running is on you.

## Setup

Install Node.js, either from [nodejs.org](https://nodejs.org) or through your package
manager. Then, in the project folder:

```sh
npm install
npm start
```

If nothing errors, the server is up. Open `localhost:3000`. Closing the terminal shuts the
server down.

Anyone who can reach your machine on that port can join you. Over the internet that means
forwarding the port or putting it behind a tunnel, which is beyond what this file covers.

## Tests

```sh
npm test
```

Most of the runtime is building and simulating every official map, which is where breakage
tends to show up. Run it before you push anything.

## How this is built

Bonk ships as one obfuscated bundle. This project runs that through the community
deobfuscator in [`resources/deobfuscator/`](resources/deobfuscator/), reads how the real game
behaves, and reimplements it. The bundle is reference material. Nothing is copied out of it.

The working rule is to measure instead of guessing. Most of the bugs this codebase has had
started as someone deciding what a number probably was. So when behaviour looks off, the
first move is reading the original's code for that rule, or capturing the real game and
comparing numbers against it.

Those measurements are written up in [`comparisons/`](comparisons/). That includes the ones
that didn't match, the parts nobody has checked yet, and anywhere this build differs from the
original deliberately.

## Layout

```
client/      browser side: rendering, input, prediction, UI
src/         maps, the map format codec, the official map pools
server.js    rooms, lobbies, the shared clock
test/        what npm test runs
scripts/     tools, like the map importer
comparisons/ measurements against the real game
resources/   reference material this is built from
```

Both sides simulate at 30 steps a second with rollback. Your input applies immediately and
gets reconciled when the server's version of the frame arrives. Drawing interpolates between
steps, so motion stays smooth without the simulation knowing anything about it.

## Contributing

Check behaviour against the real game before changing it.

Write down where your numbers came from. If you measured something, say so. If you picked a
value because it looked right, say that instead, so whoever reads it next doesn't have to
work out which kind it was.

## Licence

MIT. Bonk.io is Chaz's game. This is an independent reimplementation, built to learn from and
mess about with, and has nothing to do with him.

*p.s. if it all goes horribly wrong it's not our fault*
