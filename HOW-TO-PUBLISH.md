# Put Sun Scout online (free, 24/7) and on your phone

Sun Scout is a website made only of files, so **GitHub Pages** can host it for free, always on, with no card.
You only do this once (about 10 minutes).

## 1. Create a free GitHub account
Go to **github.com** → **Sign up**. Pick a username (it becomes part of your app's link, e.g. `yourname.github.io/sun-scout`).

## 2. Create a repository for the app
1. Click **+** (top right) → **New repository**.
2. Repository name: `sun-scout`
3. Choose **Public** (GitHub Pages is free for public repositories).
4. Click **Create repository**.

## 3. Upload the app files
1. On the new repository page, click **uploading an existing file**.
2. Open this folder in Finder and drag in **all of these**:
   - `index.html`, `style.css`, `app.js`, `scene3d.js`, `terrain.js`, `fx.js`, `ar.js`, `sw.js`, `manifest.webmanifest`, `README.md`
   - the whole `icons` folder
3. Click **Commit changes**.

## 4. Turn on GitHub Pages
1. In the repository, open **Settings** → **Pages** (left menu).
2. Under **Build and deployment** → **Source**, choose **Deploy from a branch**.
3. Branch: **main**, folder: **/ (root)** → **Save**.
4. Wait 1–2 minutes and refresh. The page shows your link:
   **`https://YOUR-USERNAME.github.io/sun-scout/`**

## 5. Put it on your phone
Open that link on your phone, then:
- **iPhone (Safari):** tap **Share ⬆️** → **Add to Home Screen** → **Add**.
- **Android (Chrome):** tap **Install** when Sun Scout offers it, or **⋮** → **Add to Home screen / Install app**.

It now opens full screen from its own ☀️ icon, like any other app. Tap **📍** to jump to where you're standing.

## Updating the app later
Upload the changed files to the same repository the same way (**Add file → Upload files**). Before uploading, open `sw.js` and
raise the number in `const VERSION = 'sunscout-v1'` (to `v2`, `v3`, …) so phones pick up the new version.

## Good to know
- **No login is needed.** All the data is free and public: OpenStreetMap, Open-Meteo, EUMETSAT, Esri imagery, AWS Terrain Tiles.
- **Your building fixes are saved on each device.** Use **💾 Save to file** / **📂 Load file** to move them between laptop and phone or share them with your crew.
- **It needs internet** (4G or Wi-Fi) for live weather, clouds and maps. With a weak signal, the app itself still opens quickly, and building and hill data for places you've already opened come back faster.
