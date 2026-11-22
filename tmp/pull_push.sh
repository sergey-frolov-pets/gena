#!/bin/bash
set -e
cd /root/.picoclaw/workspace/gena
git pull --rebase origin main
git push origin HEAD
git log --oneline -2
