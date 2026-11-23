# Deploying the Window Measurement Cloud Backend (Free)

This guide shows how to deploy the Python engine to a **100% free cloud host** (Hugging Face Spaces or Render) so that anyone can use the tool directly from GitHub Pages (`https://obrien360.github.io/bp-toolkit/Win_Measure_Complete_Tool/`) without downloading anything or running `run_tool.bat`.

---

## Option A: Hugging Face Spaces (Recommended - Free, Fast, No Credit Card Required)

Hugging Face Spaces provides free 2 vCPU / 16 GB RAM Docker containers with no credit card required.

### 1. Create a New Space
1. Log in to [huggingface.co](https://huggingface.co) (or create a free account).
2. Click your profile icon at top right &rarr; **New Space** (or go to `https://huggingface.co/new-space`).
3. Fill in the details:
   - **Space name**: `ob360-win-measure` (or any name you choose)
   - **License**: `mit` or `apache-2.0`
   - **Space SDK**: Select **Docker** &rarr; **Blank**
   - **Visibility**: **Public**
4. Click **Create Space**.

### 2. Upload the Tool Files
In your new Space repository, upload or push the files from `Win_Measure_Complete_Tool`:
- `Dockerfile`
- `requirements.txt`
- `server.py`
- `engine.py`
- `Windows_Measure_Test.pdf`

*Tip: You can use Git to push directly:*
```bash
git remote add hf https://huggingface.co/spaces/<YOUR-USERNAME>/ob360-win-measure
git push hf main
```
Or simply drag & drop those 5 files using the Hugging Face web UI (**Files** tab &rarr; **Add file** &rarr; **Upload files**).

### 3. Get Your Direct API URL
Once Hugging Face builds the container (takes ~1-2 minutes), your live backend URL will be:
```
https://<YOUR-USERNAME>-ob360-win-measure.hf.space
```
Paste this URL into `app.js` as `defaultUrl` (or enter it in the tool settings on GitHub Pages). Everything will connect automatically!

---

## Option B: Render.com (Free Web Service)

1. Sign up for a free account at [render.com](https://render.com).
2. Click **New +** &rarr; **Web Service**.
3. Connect your GitHub repository `obrien360/bp-toolkit`.
4. Configure:
   - **Root Directory**: `Win_Measure_Complete_Tool`
   - **Environment**: `Python 3` (or `Docker`)
   - **Build Command**: `pip install -r requirements.txt`
   - **Start Command**: `python server.py`
   - **Instance Type**: `Free`
5. Click **Create Web Service**.
6. Once deployed, Render gives you a URL like `https://ob360-win-measure.onrender.com`.

---

## Verifying Cloud Connection

Once deployed:
1. Open `https://obrien360.github.io/bp-toolkit/Win_Measure_Complete_Tool/` in your browser.
2. In the header, the badge will turn green: 🟢 **Cloud Backend Connected**.
3. You can now drag and drop any elevation PDF and complete window measurements entirely online!
