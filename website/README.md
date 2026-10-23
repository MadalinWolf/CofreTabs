# CofreTabs website package

Static landing page for CofreTabs. **Not deployed.** This folder is prepared so
the owner can publish it without a build step.

## Contents

```text
website/
  index.html      landing page
  privacy.html    standalone policy
  styles.css      all styling, no external CSS
  assets/         logo, favicon and icons
  README.md       this file
```

No JavaScript, no web fonts, no analytics, no third-party requests. The page is
plain HTML/CSS and works from any static host.

## Preview locally

From the repository root:

```sh
node -e "const http=require('http'),fs=require('fs'),path=require('path');const root='website';http.createServer((req,res)=>{let p=path.join(root,decodeURIComponent(req.url.split('?')[0]));if(req.url==='/'||!path.extname(p))p=path.join(root,'index.html');fs.readFile(p,(e,b)=>{if(e){res.writeHead(404);res.end('Not found');return}res.writeHead(200,{'content-type':p.endsWith('.html')?'text/html; charset=utf-8':p.endsWith('.css')?'text/css; charset=utf-8':p.endsWith('.svg')?'image/svg+xml':'image/png'});res.end(b)})}).listen(4173,()=>console.log('http://localhost:4173'))"
```

Or simply open `website/index.html` in a browser. The relative assets work
without a server.

## Deploying (owner action, not performed)

Any static host works: GitHub Pages, Netlify, Cloudflare Pages, S3, nginx.

Example with GitHub Pages after the repository is public:

1. Confirm the repository default branch.
2. Copy `website/` to the Pages source (or configure Pages to serve `/website`).
3. Add a `CNAME` only if a custom domain is verified.
4. Update `manifest.json` `homepage_url`, the README links and the store listing
   to the final URL.
5. Verify `privacy.html` is reachable and link it in the store listing if a
   policy URL is required.

## Before publishing

- [ ] Replace `TODO: ADD DONATION LINK` with a verified donation URL, or remove
      the donation line entirely.
- [ ] Confirm `https://github.com/MadalinWolf/CofreTabs` exists and is public;
      the current links point to the owner profile because the repo is not
      published yet.
- [ ] Confirm the release status copy is still accurate. If the extension is
      published, update the "not yet" language and install instructions.
- [ ] Capture and add real screenshots if desired; the current page uses a CSS
      mock panel, clearly a stylised preview.
- [ ] Check the page at 360px, 768px and 1440px widths.
- [ ] Run a link check: no dead links, no placeholder donation URL in a public
      deploy unless clearly marked.
- [ ] Confirm no personal data appears in screenshots or assets.

## Design notes

- Palette: near-black `#080b08`, phosphor green `#39ff72`, amber warnings.
- Type: system monospace stack only; no webfont downloads.
- Reduced-motion media query disables the blinking cursor and scroll animation.
- Skip link, visible focus rings and semantic headings are included.
- The hero panel is CSS/HTML, not a screenshot, so it stays sharp and contains
  no personal browsing data.

## License

Site copy and assets are part of CofreTabs, MIT © 2026 Mad Wolf Studios.
