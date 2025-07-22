# AI-Powered Aimbot for xCloud 🎮🎯

This project implements an AI-powered aimbot designed for the Xbox cloud gaming platform. It leverages TensorFlow.js and Pose detection to detect Poses in the game stream and assists the player in aiming at opponents. ~~It offers both GPU and CPU-based implementations~~ gpu/cpu ones discontinued its forced to use gpu or integrated gpu, The aimbot provides features like target prioritization, triggerbot, Rainbow ESP, and an overlay for visual feedback.

## 🚀 Key Features

- **Object Detection:** Utilizes TensorFlow.js and Pose detection to identify Enemies within the game's video stream.
- **Different OS Support:** Offers Support for Windows Linux or ChromeOS, ensuring compatibility across different systems.
- **Configurable Settings:**  A comprehensive `config` object allows users to customize various parameters, including detection confidence, target priority, aiming behavior, Triggerbot, and ESP.
- **Target Prioritization:** Selects the optimal target based on configurable criteria such as proximity.
- **Auto Prediction:** Counteracts input delay for improved accuracy.
- **Triggerbot:** Automates actions like shooting..
- **Visual Overlay:**  Displays a crosshair, field of view (FOV) circle, and bounding boxes around detected targets on an overlay canvas.
- **Dynamic Dependency Loading:** Uses `DEPENDENCIES(POSE).js` to load TensorFlow.js and Pose detection dynamically, ensuring the necessary libraries are available before the aimbot starts.

## 🛠️ Tech Stack

- **Frontend:** JavaScript
- **AI/ML:**
    - TensorFlow.js (`tf`):  JavaScript library for machine learning in the browser.
    - Pose detection:  Pre-trained object detection model.
- **Game Interaction:** Keyboard and Mouse Simulation(controller coming soon)
- **Platform:** Xbox cloud gaming

## 📦 Getting Started / Setup Instructions

### Prerequisites

- A web browser compatible with xCloud gaming (e.g., Chrome, Edge).
- A basic understanding of JavaScript and web development concepts.

### Installation

1.  **Load Dependencies:**  The `DEPENDENCIES(POSE).js` file dynamically loads TensorFlow.js and Pose detection ai model.  You'll need to execute this script in the browser's developer console on the xCloud gaming stream.

    ```javascript
    // Paste the contents of DEPENDENCIES(POSE).js into the console and execute.
    ```

2.  **Aimbot Script:** Choose `AI AIMBOT(POSE).js`. Paste the contents of the chosen script into the browser's developer console after the dependencies have loaded and the game stream is loaded.

    ```javascript
    // Paste the contents of either AI AIMBOT(POSE).js into the console and execute.
    ```

### Running Locally

This project is designed to run directly within the browser's developer console on the xCloud gaming platform. There is no separate local server or build process required.

1.  Navigate to the xCloud gaming website and start a game.
2.  Open the browser's developer console (usually by pressing F12 or ctrl + shift + i or clicking the 3 dots in the top right and clicking "more tools" then clicking developer tools then switching over to the console tab).
3.  Follow the installation steps above to load the dependencies and the aimbot script.
4.  The aimbot should now be active in the game.

## 💻 Usage

Once the aimbot is running, it will automatically detect and aim at humanoid poses(works on skins like peely or the pickle skin in fortnite) in the game. You can customize the behavior of the aimbot by modifying the config within the script. and other settings to fine-tune the aimbot to your preferences.

## 📂 Project Structure

```
├── AI Aimbot(experimental.js        # experimental versions
├── AI AIMBOT(POSE).js        # pose detection based ai aimbot
├── DEPENDENCIES(POSE).js       # Dynamically loads TensorFlow.js and the ai model
└── README.md             # Project documentation
```

## 📸 Screenshots

fortnite: 

<img src="https://media.discordapp.net/attachments/1395473504966545539/1395474201342902332/image.png?ex=687fda20&amp;is=687e88a0&amp;hm=10327e46be34c5cbd9065295c164cf7d4bd161ab5204f02a98292074c4133931&amp;=&amp;format=webp&amp;quality=lossless" alt="Image"/><img src="https://media.discordapp.net/attachments/1395473504966545539/1395474201342902332/image.png?ex=687fda20&amp;is=687e88a0&amp;hm=10327e46be34c5cbd9065295c164cf7d4bd161ab5204f02a98292074c4133931&amp;=&amp;format=webp&amp;quality=lossless" alt="Image"/><img width="977" height="812" alt="image" src="https://github.com/user-attachments/assets/43708b47-cd71-4f90-a5a0-e29d48118de1" />
<img width="977" height="812" alt="image" src="https://github.com/user-attachments/assets/6eae1890-5ebb-4f9d-9464-eef53e62e8f2" />

r6 seige:

<img src="https://media.discordapp.net/attachments/1395473504966545539/1395473568971751424/IMG_9839.png?ex=687fd989&amp;is=687e8809&amp;hm=6e1bc3670cabe818b19f5f8ea0209802a96891bd668de7110ce9d53e62323cee&amp;=&amp;format=webp&amp;quality=lossless" alt="Image"/><img width="655" height="873" alt="image" src="https://github.com/user-attachments/assets/dcf8440a-55d4-4638-9481-fbee126d4d23" />



## 🤝 Contributing

Contributions are welcome! If you have any ideas for improvements, bug fixes, or new features, please put them in the discord.

## 📝 License

This project is **NOT** licensed under the MIT License.

## 📬 Contact

If you have any questions or issues, please feel free to contact me at [guns.lol](https://guns.lol/wesd) .
