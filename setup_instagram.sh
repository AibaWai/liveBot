#!/bin/bash

echo "🔧 Instagram 監控設置腳本"

# 檢查 Python3
if ! command -v python3 &> /dev/null; then
    echo "❌ Python3 未安裝"
    exit 1
fi

echo "✅ Python3 已安裝: $(python3 --version)"

# 檢查 pip3
if ! command -v pip3 &> /dev/null; then
    echo "❌ pip3 未安裝"
    exit 1
fi

echo "✅ pip3 已安裝: $(pip3 --version)"

# 嘗試安裝 instaloader
echo "📦 正在安裝 instaloader..."

# 方法1: 使用 --user 安裝
if pip3 install --user instaloader; then
    echo "✅ instaloader 安裝成功 (--user)"
elif pip3 install instaloader; then
    echo "✅ instaloader 安裝成功"
elif python3 -m pip install --user instaloader; then
    echo "✅ instaloader 安裝成功 (python3 -m pip --user)"
elif python3 -m pip install instaloader; then
    echo "✅ instaloader 安裝成功 (python3 -m pip)"
else
    echo "❌ instaloader 安裝失敗"
    exit 1
fi

# 驗證安裝
if python3 -c "import instaloader; print('instaloader version:', instaloader.__version__)"; then
    echo "✅ instaloader 驗證成功"
else
    echo "❌ instaloader 驗證失敗"
    exit 1
fi

echo "🎉 Instagram 監控設置完成！"