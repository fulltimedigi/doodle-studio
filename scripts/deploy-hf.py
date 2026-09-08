#!/usr/bin/env python3
"""Deploy Doodle Studio to a FREE Hugging Face Space (Docker, 2 vCPU / 16 GB RAM, public URL).

Why Hugging Face and not Vercel: rendering a video needs Chromium + ffmpeg running for minutes;
Vercel functions are short-lived and have no room for that. A Docker Space runs the whole app.

One-time setup:
  pip install huggingface_hub
  export HF_TOKEN=hf_...        # from https://huggingface.co/settings/tokens  (role: write)
  python scripts/deploy-hf.py <your-hf-username>/doodle-studio [--private]

Re-run the same command to redeploy after changes. The Space sleeps after 48 h of inactivity and wakes on visit.
Add your TTS / AI keys as Space *secrets* (Settings → Variables and secrets), e.g. GEMINI_API_KEY, DOODLE_TTS=gemini.
"""
import os, sys
from huggingface_hub import HfApi

if len(sys.argv) < 2:
    sys.exit(__doc__)
repo_id = sys.argv[1]
private = '--private' in sys.argv
token = os.environ.get('HF_TOKEN')
if not token:
    sys.exit('Set HF_TOKEN first (https://huggingface.co/settings/tokens, write access).')

api = HfApi(token=token)
api.create_repo(repo_id, repo_type='space', space_sdk='docker', private=private, exist_ok=True)
# persistent storage for workspace/ and cache is optional; the free tier keeps files until the Space restarts
root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
readme = f"""---
title: Doodle Studio
emoji: 🎨
colorFrom: red
colorTo: yellow
sdk: docker
app_port: 7860
pinned: false
---
Doodle Studio — free whiteboard/doodle video maker. See README.md in the repository.
"""
api.upload_folder(
    repo_id=repo_id, repo_type='space', folder_path=root, path_in_repo='.',
    ignore_patterns=['node_modules/*', '.cache/*', 'output/*', 'workspace/*', '.git/*', '*.zip', 'scripts/.dbg/*'],
    commit_message='deploy doodle-studio',
)
api.upload_file(path_or_fileobj=readme.encode(), path_in_repo='README_SPACE.md', repo_id=repo_id, repo_type='space')
# the Space reads its config from the README.md front-matter; prepend it to the repo README
api.upload_file(path_or_fileobj=(readme + '\n' + open(os.path.join(root, 'README.md'), encoding='utf8').read()).encode(),
                path_in_repo='README.md', repo_id=repo_id, repo_type='space', commit_message='space config')
print(f'✅ deployed → https://huggingface.co/spaces/{repo_id}  (first build takes ~5 minutes)')
