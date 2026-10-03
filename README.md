# Sharp Status

Pick a video, the server re-encodes it with FFmpeg, then you share it to WhatsApp.

## Install (once)

    sudo apt install ffmpeg
    cd server && npm install
    cd ../client && npm install

## Run (two terminals)

    # terminal 1
    cd server && npm run dev

    # terminal 2
    cd client && npm run dev

Open the link Vite prints (http://localhost:5173).

## Test on your phone

The Share button only works on HTTPS. Use a tunnel:

    npx ngrok http 5173

Open the https link it prints on your phone.
