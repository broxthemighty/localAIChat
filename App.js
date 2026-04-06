import React, { useState, useRef, useEffect } from "react";
// imports
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  FlatList,
  StyleSheet,
  StatusBar,
  Keyboard,
  Platform,
  Switch,
  Modal,
  Alert,
  TouchableWithoutFeedback,
  LayoutAnimation,
  UIManager,
  Animated,
} from "react-native";

// enable LayoutAnimation for Android
/*if (
  Platform.OS === "android" &&
  UIManager.setLayoutAnimationEnabledExperimental
) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}*/

import * as FileSystem from "expo-file-system/legacy";
import { initLlama } from "llama.rn";

import { createMMKV } from "react-native-mmkv";
import { useVideoPlayer, VideoView } from "expo-video";
import { useEventListener } from "expo"; // used to listen for the video ending

/*
 * UAT MS688 Mobile Development
 *
 * Week 4
 * Assignment 4.1
 * * Local AI Chat
 *
 * By Matt Lindborg
 * * Week 1 - created the core logic and main app display
 * * Week 2 - added local storage capability and ux improvements, duck duck go api
 * * Week 3 - converted from expo go to local expo app, added updated storage using mmkv,
 *            designed and streamlined build pipeline, connecting expo to git repo,
 *            so every push to the master branch will cause a build and deploy.
 * * Week 4 - created and added an intro video to app, with option to disable play.
 *            Researched slm's to use.
 */

// roadmap for future vector database integration:
// a. add slm support, so the ai chat actually uses an ai.
// b. add model searching similar to lm studio, using hugging face api.
// -----
// 1. implement text embedding: convert user input into high-dimensional vectors (e.g., via onnx runtime).
// 2. setup local vector store: integrate a mobile-compatible vector library (like sqlite-vss) to replace json-based history. (need a schema that works)
// 3. semantic search: enable the ai to "remember" context by searching the database for visually/thematically similar past messages.
// 4. context windowing: feed retrieved vector results back into the ai prompt for "long-term memory" capabilities.

// MMKV storage instance
const storage = createMMKV();

// storage key variables
const CHAT_STORAGE_KEY = "@chat_history";
const THEME_STORAGE_KEY = "@theme_setting";
const USER_NAME_KEY = "@user_name";
const SYSTEM_PROMPT_KEY = "@system_prompt";

// three animated dots for ai processing
const TypingIndicator = ({ isDarkMode }) => {
  // master clock for all three dots
  const anim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    anim.setValue(0);

    // master loop runs from 0 to 1 over 1.2 seconds
    const loop = Animated.loop(
      Animated.timing(anim, {
        toValue: 1,
        duration: 1200,
        useNativeDriver: true,
      }),
    );
    loop.start();

    // stop the animation thread completely when the component unmounts
    return () => loop.stop();
  }, [anim]);

  // interpolate the single clock value into staggered movements
  const getDotStyle = (index) => {
    const start = index * 0.2;
    const peak = start + 0.2;
    const end = start + 0.4;

    return {
      opacity: anim.interpolate({
        inputRange: [0, start, peak, end, 1],
        outputRange: [0.3, 0.3, 1, 0.3, 0.3],
        extrapolate: "clamp", // prevents values from exceeding limits
      }),
      transform: [
        {
          translateY: anim.interpolate({
            inputRange: [0, start, peak, end, 1],
            outputRange: [0, 0, -6, 0, 0],
            extrapolate: "clamp",
          }),
        },
      ],
    };
  };

  return (
    <View style={styles.typingContainer}>
      <Animated.View
        style={[
          styles.dot,
          isDarkMode ? styles.darkDot : styles.lightDot,
          getDotStyle(0),
        ]}
      />
      <Animated.View
        style={[
          styles.dot,
          isDarkMode ? styles.darkDot : styles.lightDot,
          getDotStyle(1),
        ]}
      />
      <Animated.View
        style={[
          styles.dot,
          isDarkMode ? styles.darkDot : styles.lightDot,
          getDotStyle(2),
        ]}
      />
    </View>
  );
};

// typewriter text animation
const TypeWriterText = ({ text, style, onTypingComplete, scrollViewRef }) => {
  const [displayedText, setDisplayedText] = useState("");
  const index = useRef(0);

  useEffect(() => {
    index.current = 0;
    setDisplayedText("");

    const timer = setInterval(() => {
      if (index.current < text.length) {
        setDisplayedText((prev) => prev + text.charAt(index.current));
        index.current++;

        // gently scroll to bottom as text expands
        if (index.current % 15 === 0 && scrollViewRef?.current) {
          scrollViewRef.current.scrollToEnd({ animated: true });
        }
      } else {
        clearInterval(timer);
        if (onTypingComplete) onTypingComplete();
      }
    }, 20); // typing speed

    return () => clearInterval(timer);
  }, [text]);

  return <Text style={style}>{displayedText}</Text>;
};

// slm prompt
/*const SYSTEM_PROMPT = {
  role: "system",
  content:
    "You are a helpful, witty, and highly conversational AI companion. Your goal is to build a friendly relationship with the user. You occasionally use mild sarcasm, but you are ultimately supportive and kind. Keep your responses concise and natural, as if texting a friend.",
};*/

// main app
export default function App() {
  // state variables
  const [messages, setMessages] = useState([]);
  const [inputText, setInputText] = useState("");
  const [userName, setUserName] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [isDarkMode, setIsDarkMode] = useState(false);
  const [isSettingsVisible, setIsSettingsVisible] = useState(false);
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const [llamaContext, setLlamaContext] = useState(null);
  const [animatingMessageId, setAnimatingMessageId] = useState(null);

  // slm variables
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [isDownloading, setIsDownloading] = useState(false);
  const [modelReady, setModelReady] = useState(false);
  const [systemPrompt, setSystemPrompt] = useState(
    "You are a helpful, witty, and highly conversational AI companion. Your goal is to build a friendly relationship with the user. You occasionally use mild sarcasm, but you are ultimately supportive and kind. Keep your responses concise and natural, as if texting a friend.",
  );
  const [isPromptModalVisible, setIsPromptModalVisible] = useState(false);

  // the direct link to a mobile-friendly conversational model (currently Llama-3.2-1B-Instruct)
  const MODEL_URL =
    "https://huggingface.co/bartowski/Llama-3.2-1B-Instruct-GGUF/resolve/main/Llama-3.2-1B-Instruct-Q4_K_M.gguf";
  const MODEL_FILENAME = "companion_ai_model.gguf";
  const MODEL_PATH = `${FileSystem.documentDirectory}${MODEL_FILENAME}`;
  const MODEL_DISPLAY_NAME = "Llama 3.2 1B Instruct (Q4)";

  // read from storage on startup. default to 'true' if the key doesn't exist yet.
  const [playIntroVideo, setPlayIntroVideo] = useState(
    storage.getBoolean("showSplashVideo") ?? true,
  );
  // if playIntroVideo is false, isVideoFinished starts as true,
  // skipping the splash screen.
  const [isVideoFinished, setIsVideoFinished] = useState(!playIntroVideo);

  // initialize the expo-video player
  const player = useVideoPlayer(
    require("./assets/Synthlizard_Studios_Logo_Animated.mp4"),
    (player) => {
      player.loop = false;
      if (playIntroVideo) {
        player.play(); // auto-play if settings allow it
      }
    },
  );

  // listen for the exact moment the video finishes
  useEventListener(player, "playToEnd", () => {
    setIsVideoFinished(true);
  });

  // list reference variable
  const flatListRef = useRef(null);

  // load chat history, slm, and listeners on startup
  useEffect(() => {
    loadInitialData();
    const checkModel = async () => {
      const info = await FileSystem.getInfoAsync(MODEL_PATH);
      if (info.exists) {
        setModelReady(true);
      }
    };
    checkModel();

    // keyboard listeners for dynamic height tracking
    const showSub = Keyboard.addListener(
      Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow",
      (e) => setKeyboardHeight(e.endCoordinates.height),
    );
    const hideSub = Keyboard.addListener(
      Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide",
      () => setKeyboardHeight(0),
    );

    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  // slm initilizaion
  useEffect(() => {
    let context = null;
    const setupLlama = async () => {
      // only initialize if the model is downloaded and we don't already have a context
      if (modelReady && !llamaContext) {
        try {
          console.log("Loading model into memory...");
          context = await initLlama({
            model: MODEL_PATH,
            use_mlock: true, // prevents the OS from paging the model out of RAM
            n_ctx: 2048, // context window size
            n_gpu_layers: 1, // uses device GPU for faster processing
          });
          setLlamaContext(context);
          console.log("Llama context initialized and ready!");
        } catch (error) {
          console.error("Failed to init Llama:", error);
          Alert.alert("Engine Error", "Failed to load the AI engine.");
        }
      }
    };
    setupLlama();

    return () => {
      if (context) {
        context.release(); // frees up device RAM when closing
      }
    };
  }, [modelReady]);

  // load all stored data variable
  const loadInitialData = () => {
    try {
      const savedTheme = storage.getString(THEME_STORAGE_KEY);
      const savedName = storage.getString(USER_NAME_KEY);
      const savedMessages = storage.getString(CHAT_STORAGE_KEY);
      const savedPrompt = storage.getString(SYSTEM_PROMPT_KEY); // NEW

      if (savedPrompt) {
        setSystemPrompt(savedPrompt);
      }

      if (savedTheme) {
        setIsDarkMode(savedTheme === "dark");
      }

      const currentUserName = savedName || "Guest";
      setUserName(currentUserName);

      if (savedMessages) {
        setMessages(JSON.parse(savedMessages));
      } else {
        // default welcome message using stored username
        setMessages([
          {
            id: "welcome",
            text: `Hello, ${currentUserName}! I am your local AI. Type 'search [topic]' to search the web.`,
            sender: "ai",
          },
        ]);
      }
    } catch (e) {
      console.error("Failed to load initial data:", e);
    }
  };

  // download the slm
  const downloadModel = async () => {
    setIsDownloading(true);
    try {
      const downloadResumable = FileSystem.createDownloadResumable(
        MODEL_URL,
        MODEL_PATH,
        {},
        (downloadProgress) => {
          const progress =
            downloadProgress.totalBytesWritten /
            downloadProgress.totalBytesExpectedToWrite;
          setDownloadProgress((progress * 100).toFixed(1));
        },
      );

      const { uri } = await downloadResumable.downloadAsync();
      console.log("Model downloaded to:", uri);
      setModelReady(true);
      storage.set("modelDownloaded", true); // save the state so we know it's there next time
      Alert.alert("Success", "Companion AI downloaded and ready!");
    } catch (e) {
      console.error(e);
      Alert.alert("Error", "Failed to download the model.");
    } finally {
      setIsDownloading(false);
    }
  };

  // save history variable
  const saveChatHistory = (newMessages) => {
    try {
      storage.set(CHAT_STORAGE_KEY, JSON.stringify(newMessages));
    } catch (e) {
      console.error("Failed to save chat history:", e);
    }
  };

  // save username variable
  const saveUserName = (name) => {
    try {
      setUserName(name);
      storage.set(USER_NAME_KEY, name);
    } catch (e) {
      console.error("Failed to save username:", e);
    }
  };

  const saveSystemPrompt = () => {
    try {
      storage.set(SYSTEM_PROMPT_KEY, systemPrompt);
      setIsPromptModalVisible(false);
    } catch (e) {
      console.error("Failed to save system prompt:", e);
    }
  };

  // toggle theme variable
  const toggleTheme = () => {
    try {
      const newMode = !isDarkMode;
      setIsDarkMode(newMode);
      storage.set(THEME_STORAGE_KEY, newMode ? "dark" : "light");
    } catch (e) {
      console.error("Failed to save theme preference:", e);
    }
  };

  // reset profile variable
  const confirmResetProfile = () => {
    Alert.alert(
      "Reset Profile",
      "This will clear your username and theme settings. Chat history will be untouched.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Reset", style: "destructive", onPress: resetProfile },
      ],
    );
  };

  // handle profile reset variable
  const resetProfile = () => {
    try {
      storage.remove(THEME_STORAGE_KEY);
      storage.remove(USER_NAME_KEY);
      setIsDarkMode(false);
      setUserName("Guest");
      setIsSettingsVisible(false);
    } catch (e) {
      console.error("Failed to reset profile:", e);
    }
  };

  // clear chat variable
  const clearChat = () => {
    try {
      storage.remove(CHAT_STORAGE_KEY);
      const resetMessage = [
        {
          id: Date.now().toString(),
          text: "Chat history cleared. How can I help you?",
          sender: "ai",
        },
      ];
      setMessages(resetMessage);
      saveChatHistory(resetMessage);
    } catch (e) {
      console.error("Failed to clear chat:", e);
    }
  };

  // duck duck go fetch variable
  const fetchDuckDuckGo = async (query) => {
    try {
      const response = await fetch(
        `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json`,
      );
      const data = await response.json();

      if (data.AbstractText) {
        return data.AbstractText;
      } else if (
        data.RelatedTopics &&
        data.RelatedTopics.length > 0 &&
        data.RelatedTopics[0].Text
      ) {
        return data.RelatedTopics[0].Text;
      } else {
        return "I searched DuckDuckGo, but I couldn't find a quick summary for that.";
      }
    } catch (error) {
      console.error("DDG fetch error:", error);
      return "Sorry, my internet connection seems to be down.";
    }
  };

  // function to handle the toggle in settings window
  const handleToggleVideo = (value) => {
    setPlayIntroVideo(value);
    storage.set("showSplashVideo", value); // save preference
  };

  // splash screen logo
  if (!isVideoFinished) {
    return (
      <View style={styles.videoContainer}>
        <StatusBar hidden />
        <VideoView
          style={styles.videoPlayer}
          player={player}
          nativeControls={false} // hide the playback controls
          contentFit="contain" // centers video with black background
        />
      </View>
    );
  }

  // handle message send variable
  const handleSend = async () => {
    if (inputText.trim() === "") return;

    // keyboard dismissal on send
    Keyboard.dismiss();

    const currentInput = inputText;
    const userMsg = {
      id: Date.now().toString(),
      text: currentInput,
      sender: "user",
    };

    // trigger smooth layout animation before state update
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);

    // update state and save to storage
    const updatedWithUser = [...messages, userMsg];
    setMessages(updatedWithUser);
    saveChatHistory(updatedWithUser);

    setInputText("");
    setIsTyping(true);

    const lowerInput = currentInput.toLowerCase();

    // check for name change command
    let detectedName = null;
    if (lowerInput.startsWith("my name is "))
      detectedName = currentInput.substring(11).trim();
    else if (lowerInput.startsWith("call me "))
      detectedName = currentInput.substring(8).trim();

    if (detectedName) {
      await saveUserName(detectedName);
      setTimeout(() => {
        const aiMsg = {
          id: Date.now().toString(),
          text: `Got it! I've updated your name to ${detectedName}.`,
          sender: "ai",
        };
        setAnimatingMessageId(aiMsg.id);
        const final = [...updatedWithUser, aiMsg];
        setMessages(final);
        saveChatHistory(final);
        setIsTyping(false);
        // explicit scroll call
        setTimeout(
          () => flatListRef.current?.scrollToEnd({ animated: true }),
          100,
        );
      }, 1000);
      return;
    }

    const isSearchCommand = lowerInput.startsWith("search ");

    if (isSearchCommand) {
      const query = currentInput.substring(7);
      const searchResult = await fetchDuckDuckGo(query);

      const aiMsg = {
        id: (Date.now() + 1).toString(),
        text: `🔍 Web Search Result:\n\n${searchResult}`,
        sender: "ai",
      };
      setAnimatingMessageId(aiMsg.id);
      const updatedWithSearch = [...updatedWithUser, aiMsg];
      setMessages(updatedWithSearch);
      saveChatHistory(updatedWithSearch);
      setIsTyping(false);
      // explicit scroll call
      setTimeout(
        () => flatListRef.current?.scrollToEnd({ animated: true }),
        100,
      );
    } else {
      // mock ai
      /*setTimeout(() => {
        const aiMsg = {
          id: (Date.now() + 1).toString(),
          text: `This is a saved simulated response, ${userName}! History will persist.`,
          sender: "ai",
        };
        const updatedWithMock = [...updatedWithUser, aiMsg];
        setMessages(updatedWithMock);
        saveChatHistory(updatedWithMock);
        setIsTyping(false);
        // explicit scroll call
        setTimeout(
          () => flatListRef.current?.scrollToEnd({ animated: true }),
          100,
        );
      }, 1500);*/

      // real slm
      // check if the AI is actually loaded into RAM
      if (!llamaContext) {
        Alert.alert(
          "AI Not Ready",
          "Please download the model from settings or wait for it to load.",
        );
        setIsTyping(false);
        return;
      }

      try {
        // format the conversation history for Llama
        // map message objects into the format the model expects: "User: Hello \n Assistant: Hi!"
        let formattedHistory = `${systemPrompt}\n\n`;
        updatedWithUser.forEach((msg) => {
          if (msg.id !== "welcome") {
            // skip the hardcoded welcome message
            const role = msg.sender === "user" ? userName : "Assistant";
            formattedHistory += `${role}: ${msg.text}\n`;
          }
        });
        formattedHistory += "Assistant:"; // Prompt the AI to start speaking

        // ask the AI to generate a response
        const response = await llamaContext.completion({
          prompt: formattedHistory,
          n_predict: 150, // max words to generate
          temperature: 0.7, // adds slight creativity/personality
          stop: ["\nUser:", `\n${userName}:`, "\nAssistant:"], // tells the AI to stop generating when it thinks it's user's turn to speak
        });

        // output the result to the chat
        const aiMsg = {
          id: (Date.now() + 1).toString(),
          text: response.text.trim(),
          sender: "ai",
        };
        setAnimatingMessageId(aiMsg.id);
        const finalMessages = [...updatedWithUser, aiMsg];
        setMessages(finalMessages);
        saveChatHistory(finalMessages);
        setIsTyping(false);

        setTimeout(
          () => flatListRef.current?.scrollToEnd({ animated: true }),
          100,
        );
      } catch (error) {
        console.error("Generation error:", error);
        setIsTyping(false);
        Alert.alert("Error", "The AI failed to generate a response.");
      }
    }
  };

  // start of render
  return (
    <View
      style={[
        styles.container,
        isDarkMode && styles.darkContainer,
        { paddingBottom: keyboardHeight },
      ]}
    >
      <StatusBar barStyle={isDarkMode ? "light-content" : "dark-content"} />

      <Modal
        animationType="fade"
        transparent={true}
        visible={isSettingsVisible}
        onRequestClose={() => setIsSettingsVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View
            style={[
              styles.modalContent,
              isDarkMode ? styles.darkModal : styles.lightModal,
            ]}
          >
            <Text style={[styles.modalTitle, isDarkMode && styles.darkText]}>
              Settings
            </Text>

            <View style={styles.settingRow}>
              <Text style={[styles.modalLabel, isDarkMode && styles.darkText]}>
                Theme: {isDarkMode ? "Dark" : "Light"}
              </Text>
              <Switch
                value={isDarkMode}
                onValueChange={toggleTheme}
                trackColor={{ false: "#767577", true: "#34C759" }}
              />
            </View>

            <View style={styles.settingRow}>
              <Text style={[styles.modalLabel, isDarkMode && styles.darkText]}>
                Show Animated Logo{"\n"}on Startup
              </Text>
              <Switch
                value={playIntroVideo}
                onValueChange={handleToggleVideo}
                trackColor={{ false: "#767577", true: "#81b0ff" }}
                thumbColor={playIntroVideo ? "#2196F3" : "#f4f3f4"}
              />
            </View>

            <View style={styles.settingRow}>
              <Text style={[styles.modalLabel, isDarkMode && styles.darkText]}>
                Companion AI Model
              </Text>

              {modelReady ? (
                <Text style={{ color: "#34C759", fontWeight: "bold" }}>
                  Installed ✓
                </Text>
              ) : isDownloading ? (
                <Text style={{ color: "#007AFF" }}>{downloadProgress}%</Text>
              ) : (
                <TouchableOpacity
                  style={{
                    backgroundColor: "#007AFF",
                    padding: 8,
                    borderRadius: 8,
                  }}
                  onPress={downloadModel}
                >
                  <Text style={{ color: "#fff", fontWeight: "bold" }}>
                    Download
                  </Text>
                </TouchableOpacity>
              )}
            </View>

            {modelReady && (
              <View style={styles.settingRow}>
                <Text
                  style={[styles.modalLabel, isDarkMode && styles.darkText]}
                >
                  Active Brain:
                </Text>
                <Text
                  style={[
                    styles.modalLabel,
                    {
                      color: isDarkMode ? "#aaa" : "#666",
                      fontSize: 14,
                      fontWeight: "normal",
                    },
                  ]}
                >
                  {MODEL_DISPLAY_NAME}
                </Text>
              </View>
            )}

            <TouchableOpacity
              style={styles.resetButton}
              onPress={confirmResetProfile}
            >
              <Text style={styles.resetText}>Reset User Profile</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.closeButton}
              onPress={() => setIsSettingsVisible(false)}
            >
              <Text style={styles.closeText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <Modal
        animationType="slide"
        transparent={true}
        visible={isPromptModalVisible}
        onRequestClose={() => setIsPromptModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View
            style={[
              styles.modalContent,
              isDarkMode ? styles.darkModal : styles.lightModal,
            ]}
          >
            <Text style={[styles.modalTitle, isDarkMode && styles.darkText]}>
              AI Personality
            </Text>

            <TextInput
              style={[styles.promptInput, isDarkMode && styles.darkInput]}
              value={systemPrompt}
              onChangeText={setSystemPrompt}
              multiline={true}
              numberOfLines={6}
              showsVerticalScrollIndicator={true}
              placeholder="Enter the instructions for the AI's personality..."
              placeholderTextColor={isDarkMode ? "#aaa" : "#888"}
            />

            <TouchableOpacity
              style={[styles.resetButton, { backgroundColor: "#34C759" }]}
              onPress={saveSystemPrompt}
            >
              <Text style={styles.resetText}>Save Settings</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.closeButton}
              onPress={() => setIsPromptModalVisible(false)}
            >
              <Text style={styles.closeText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <View style={[styles.header, isDarkMode && styles.darkHeader]}>
        <View style={styles.headerLeft}>
          <Text style={[styles.title, isDarkMode && styles.darkText]}>
            Local AI
          </Text>
          <Text
            style={[
              styles.userLabel,
              isDarkMode ? styles.darkText : styles.lightText,
            ]}
          >
            User: {userName}
          </Text>
        </View>
        <View style={styles.headerControls}>
          <TouchableOpacity
            onPress={() => setIsPromptModalVisible(true)}
            style={styles.gearButton}
          >
            <Text style={{ fontSize: 24 }}>{"📝"}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => setIsSettingsVisible(true)}
            style={styles.gearButton}
          >
            <Text style={{ fontSize: 24 }}>{"⚙️"}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.clearButton} onPress={clearChat}>
            <Text style={styles.clearText}>Clear</Text>
          </TouchableOpacity>
        </View>
      </View>

      <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
        <FlatList
          ref={flatListRef}
          data={messages}
          keyExtractor={(item) => item.id}
          style={styles.chatList}
          contentContainerStyle={styles.chatContainer}
          onContentSizeChange={() =>
            flatListRef.current?.scrollToEnd({ animated: true })
          }
          onLayout={() =>
            flatListRef.current?.scrollToEnd({ animated: false })
          }
          renderItem={({ item }) => {
            const shouldAnimate = item.id === animatingMessageId;

            return (
              <View
                style={[
                  styles.messageWrapper,
                  item.sender === "user"
                    ? styles.userWrapper
                    : isDarkMode
                      ? styles.darkAiWrapper
                      : styles.aiWrapper,
                ]}
              >
                {shouldAnimate ? (
                  <TypeWriterText
                    text={item.text}
                    style={[
                      styles.messageText,
                      isDarkMode ? styles.darkText : styles.aiText,
                    ]}
                    scrollViewRef={flatListRef}
                  />
                ) : (
                  <Text
                    style={[
                      styles.messageText,
                      item.sender === "user"
                        ? styles.userText
                        : isDarkMode
                          ? styles.darkText
                          : styles.aiText,
                    ]}
                  >
                    {item.text}
                  </Text>
                )}
              </View>
            );
          }}
        />
      </TouchableWithoutFeedback>

      {isTyping && <TypingIndicator isDarkMode={isDarkMode} />}

      <View
        style={[
          styles.inputRow,
          isDarkMode && styles.darkHeader,
          { paddingBottom: keyboardHeight > 0 ? 55 : 50 },
        ]}
      >
        <TextInput
          style={[styles.input, isDarkMode && styles.darkInput]}
          value={inputText}
          onChangeText={setInputText}
          placeholder="Type a message..."
          placeholderTextColor={isDarkMode ? "#aaa" : "#888"}
          multiline={true}
          onFocus={() =>
            setTimeout(
              () => flatListRef.current?.scrollToEnd({ animated: true }),
              200,
            )
          }
        />
        <TouchableOpacity style={styles.sendButton} onPress={handleSend}>
          <Text style={styles.sendText}>Send</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

// style sheet
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f5f5f5",
  },
  darkContainer: {
    backgroundColor: "#1c1c1e",
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingTop: 50,
    paddingHorizontal: 20,
    paddingBottom: 10,
    backgroundColor: "#fff",
    borderBottomWidth: 1,
    borderBottomColor: "#ddd",
  },
  darkHeader: {
    backgroundColor: "#2c2c2e",
    borderBottomColor: "#3a3a3c",
  },
  headerLeft: {
    flex: 1,
  },
  headerControls: {
    flexDirection: "row",
    alignItems: "center",
  },
  userLabel: {
    fontSize: 12,
    fontWeight: "bold",
    marginTop: 2,
  },
  title: {
    fontSize: 20,
    fontWeight: "bold",
    color: "#333",
  },
  lightText: {
    color: "#333",
  },
  darkText: {
    color: "#fff",
  },
  gearButton: {
    marginRight: 15,
  },
  clearButton: {
    padding: 8,
    backgroundColor: "#ff3b30",
    borderRadius: 8,
  },
  clearText: {
    color: "#fff",
    fontWeight: "bold",
    fontSize: 12,
  },
  chatList: {
    flex: 1,
  },
  chatContainer: {
    padding: 15,
    paddingBottom: 20,
  },
  messageWrapper: {
    maxWidth: "80%",
    padding: 12,
    borderRadius: 15,
    marginBottom: 10,
  },
  userWrapper: {
    alignSelf: "flex-end",
    backgroundColor: "#007AFF",
    borderBottomRightRadius: 5,
  },
  aiWrapper: {
    alignSelf: "flex-start",
    backgroundColor: "#e5e5ea",
    borderBottomLeftRadius: 5,
  },
  darkAiWrapper: {
    alignSelf: "flex-start",
    backgroundColor: "#3a3a3c",
    borderBottomLeftRadius: 5,
  },
  messageText: {
    fontSize: 16,
    lineHeight: 22,
  },
  userText: {
    color: "#fff",
  },
  aiText: {
    color: "#000",
  },
  typingIndicator: {
    paddingHorizontal: 20,
    paddingBottom: 10,
    color: "#888",
    fontStyle: "italic",
  },
  inputRow: {
    flexDirection: "row",
    paddingHorizontal: 15,
    paddingTop: 10,
    backgroundColor: "#fff",
    borderTopWidth: 1,
    borderColor: "#ddd",
    alignItems: "center",
  },
  input: {
    flex: 1,
    minHeight: 40,
    maxHeight: 100,
    backgroundColor: "#f0f0f0",
    borderRadius: 20,
    paddingHorizontal: 15,
    paddingVertical: 10,
    fontSize: 16,
    color: "#333",
  },
  darkInput: {
    backgroundColor: "#3a3a3c",
    color: "#fff",
  },
  sendButton: {
    marginLeft: 10,
    backgroundColor: "#111",
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 20,
    justifyContent: "center",
  },
  sendText: {
    color: "#fff",
    fontWeight: "bold",
    fontSize: 16,
  },
  modalOverlay: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.5)",
  },
  modalContent: {
    width: "85%",
    borderRadius: 25,
    padding: 30,
    alignItems: "center",
    elevation: 20,
  },
  lightModal: {
    backgroundColor: "#fff",
  },
  darkModal: {
    backgroundColor: "#2c2c2e",
  },
  modalTitle: {
    fontSize: 24,
    fontWeight: "bold",
    marginBottom: 25,
  },
  modalLabel: {
    fontSize: 16,
    fontWeight: "600",
  },
  settingRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    width: "100%",
    marginBottom: 30,
  },
  resetButton: {
    backgroundColor: "#ff3b30",
    padding: 15,
    borderRadius: 15,
    width: "100%",
    alignItems: "center",
    marginBottom: 15,
  },
  resetText: {
    color: "#fff",
    fontWeight: "bold",
    fontSize: 16,
  },
  closeButton: {
    marginTop: 10,
  },
  closeText: {
    color: "#007AFF",
    fontWeight: "bold",
    fontSize: 17,
  },
  videoContainer: {
    flex: 1,
    backgroundColor: "#000", // black background prevents white flashes during load
    justifyContent: "center",
    alignItems: "center",
  },
  videoPlayer: {
    width: "100%",
    height: "100%",
  },
  typingContainer: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 25,
    paddingBottom: 15,
    height: 30, // keeps the height stable while dots bounce
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 6,
  },
  lightDot: {
    backgroundColor: "#888",
  },
  darkDot: {
    backgroundColor: "#aaa",
  },
  promptInput: {
    width: "100%",
    height: 160,
    backgroundColor: "#f0f0f0",
    borderRadius: 15,
    paddingHorizontal: 15,
    paddingVertical: 15,
    fontSize: 16,
    color: "#333",
    textAlignVertical: "top",
    marginBottom: 20,
  },
});
