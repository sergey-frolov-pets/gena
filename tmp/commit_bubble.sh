#!/bin/bash
set -e
cd /root/.picoclaw/workspace/gena
git add -A
git commit -m "refactor(chat): пузырь сообщения вынесен в MessageBubble, markdown-помощники в lib/chat-markdown"
git log --oneline -1
