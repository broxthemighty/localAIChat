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
  ScrollView,
  ActivityIndicator,
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
import { SafeAreaView, SafeAreaProvider } from 'react-native-safe-area-context';

/*
 * UAT MS688 Mobile Development
 *
 * Week 7
 * Assignment 7.1
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
 * * Week 5 - added animation to the app, for text generation and three dots loading.
 *            Also added the live ai model, download link in the settings, and other
 *            quality of life updates. 
 * * Week 6 - added a proof of concept (POC) for the integration of the vector database,
 *            putting it under Vector DB Pipeline as a modal to get to it through settings.
 * * Week 7 - modified the POC vector data testing addition from last week, using it to test
 *            live data saved in the app. 
 *            Added additional improvements to the data handling, including memory consolidation,
 *            unnecessary word removal, timestamp management, and data summary creation.
 *            Trying to emulate a similar data handling present in the major cloud based 
 *            services, but on the local device.
 */

// roadmap for future vector database integration:
// a. add slm support, so the ai chat actually uses an ai. ***DONE***
// b. add model searching similar to lm studio, using hugging face api. FUTURE
// -----
// 1. implement text embedding: convert user input into high-dimensional vectors (e.g., via onnx runtime). ***DONE***
// 2. setup local vector store: integrate a mobile-compatible vector library (like sqlite-vss) to replace json-based history. (need a schema that works)
//    ***DONE*** using MMKV to store data.
// 3. semantic search: enable the ai to "remember" context by searching the database for visually/thematically similar past messages. ***DONE***
// 4. context windowing: feed retrieved vector results back into the ai prompt for "long-term memory" capabilities. ***DONE***

// This function calculates Cosine Similarity. If retrieval fails or returns weird matches,
// I have placed console.logs inside handleRetrieveMemoryPOC to output the exact 
// score generated here, allowing me to debug the math logic without crashing the UI.
// --- vector database POC utility ---
const generateMockEmbedding = (text) => {
  console.log("[Embedding] Generating embedding for text length:", text.length);
  const vector = new Array(5).fill(0).map((_, i) => {
    return (text.charCodeAt(i % text.length) || 1) / 100;
  });
  console.log("[Embedding] Vector size:", vector.length);
  return vector;
};

const cosineSimilarity = (vecA, vecB) => {
  // safety checks to prevent the 0.00 bug
  if (!Array.isArray(vecA) || !Array.isArray(vecB)) {
    console.error("[Math Error] Vectors are not arrays! Check your embedding extraction.");
    return 0;
  }
  if (vecA.length !== vecB.length) {
    console.error(`[Math Error] Dimension mismatch! VecA: ${vecA.length}, VecB: ${vecB.length}`);
    return 0;
  }

  let dotProduct = 0, normA = 0, normB = 0;
  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += Math.pow(vecA[i], 2);
    normB += Math.pow(vecB[i], 2);
  }
  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
};

// --- advanced RAG utility time decay penalty ---
// penalizes older memories so newer facts win in a tie-breaker.
const applyTimeDecay = (baseScore, memoryTimestamp) => {
  const now = Date.now();
  const memoryAgeMs = now - parseInt(memoryTimestamp);
  
  // convert age to days (or hours/minutes depending on testing)
  // memory loses 0.01 score for every minute old it is, capping at -0.15
  const ageInMinutes = memoryAgeMs / (1000 * 60);
  const penalty = Math.min(ageInMinutes * 0.01, 0.15); 
  
  return baseScore - penalty;
};

const generateRealEmbedding = async (text, context) => {
  if (!context) return null;
  try {
    console.log("[Embedding] Requesting real vector for:", text.substring(0, 20) + "...");
    
    // call the engine
    const result = await context.embedding(text);
    
    // extract the actual array from the result object
    const vectorArray = result.embedding ? result.embedding : result;
    
    console.log("[Embedding] Real vector generated successfully. Array Size:", vectorArray.length);
    return vectorArray; 
  } catch (error) {
    console.error("[Embedding Error]:", error);
    return null;
  }
};

// -------------------------------

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

// main app
export default function App() {
  // state variables
  const [messages, setMessages] = useState([]);
  const [inputText, setInputText] = useState("");
  const [userName, setUserName] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [isDarkMode, setIsDarkMode] = useState(false);
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const [llamaContext, setLlamaContext] = useState(null);
  const [animatingMessageId, setAnimatingMessageId] = useState(null);
  const [activeScreen, setActiveScreen] = useState("chat"); // 'chat' or 'settings'

  // vector poc variables
  const [isVectorPOCVisible, setIsVectorPOCVisible] = useState(false);
  const [pocQueryInput, setPocQueryInput] = useState("");
  const [pocRetrievedResults, setPocRetrievedResults] = useState([]);

  const [isConsolidating, setIsConsolidating] = useState(false);

  // --- date boundary checker ---
  const checkAndRunConsolidation = async (currentMessages, context) => {
    const now = new Date();
    // get the exact millisecond timestamp for 12:00 AM today
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();

    // find raw messages older than today
    const oldRawMessages = currentMessages.filter(msg => 
      msg.sender === "user" && 
      msg.vector && 
      !msg.isHidden &&
      parseInt(msg.timestamp) < startOfToday
    );

    if (oldRawMessages.length > 0) {
      console.log(`[Memory] Date boundary crossed! Summarizing ${oldRawMessages.length} messages.`);
      setIsConsolidating(true); 

      const newSummaryNode = await consolidateMemories(oldRawMessages, context);

      if (newSummaryNode) {
        // strip vectors from old messages to save math-time and storage
        const updatedHistory = currentMessages.map(msg => {
          if (oldRawMessages.some(oldMsg => oldMsg.id === msg.id)) {
            const { vector, ...restOfMsg } = msg; 
            return restOfMsg;
          }
          return msg;
        });

        // add the new hidden summary node
        updatedHistory.push(newSummaryNode);
        
        setMessages(updatedHistory);
        saveChatHistory(updatedHistory);
        console.log("[Memory] Consolidation complete. Old vectors stripped.");
      }
      setIsConsolidating(false);
    }
  };

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
            embedding: true, // required for vectors
          });
          setLlamaContext(context);
          console.log("Llama context initialized and ready!");

          // check for old memories to summarize immediately upon loading the model
          const savedStr = storage.getString(CHAT_STORAGE_KEY);
          const initialMsgs = savedStr ? JSON.parse(savedStr) : [];
          checkAndRunConsolidation(initialMsgs, context);
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
      const savedPrompt = storage.getString(SYSTEM_PROMPT_KEY);

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
      setActiveScreen("chat");
    } catch (e) {
      console.error("Failed to reset profile:", e);
    }
  };

  // --- ui action: clear screen only ---
  const clearScreenOnly = () => {
    setMessages([
      {
        id: "welcome",
        text: `Hello, ${userName}! Screen cleared. My long-term memory is still intact.`,
        sender: "ai",
      },
    ]);
    // intentionally do NOT call saveChatHistory here so MMKV stays intact
  };

  // --- database action: warning popup ---
  const confirmEraseMemory = () => {
    Alert.alert(
      "Erase All Memory?",
      "This will permanently delete all chat history and vector memories. This cannot be undone.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Erase Everything", style: "destructive", onPress: eraseAllMemory },
      ]
    );
  };

  // --- database action: permanent wipe ---
  const eraseAllMemory = () => {
    try {
      storage.remove(CHAT_STORAGE_KEY);
      const resetMessage = [
        {
          id: Date.now().toString(),
          text: "Memory wiped. All chat history and vectors have been permanently erased.",
          sender: "ai",
        },
      ];
      setMessages(resetMessage);
      saveChatHistory(resetMessage);
      setActiveScreen("chat"); // return to chat screen after wiping
    } catch (e) {
      console.error("Failed to clear memory:", e);
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

  // --- memory inspector debug tool --- //
  const handleRetrieveMemoryPOC = async () => {
    if (!pocQueryInput.trim()) {
      Alert.alert("Notice", "Enter a query to search your active chat memory.");
      return;
    }
    if (!llamaContext) {
      Alert.alert("Notice", "Please wait for the AI engine to load.");
      return;
    }

    try {
      console.log("\n--- DEBUG: MANUAL MEMORY RETRIEVAL ---");
      console.log("[Inspector] Searching real chat history for:", pocQueryInput);
      
      // vectorize the debug query
      const queryEmbedding = await generateRealEmbedding(pocQueryInput.trim().toLowerCase(), llamaContext);

      if (!queryEmbedding) {
        console.error("[Inspector] Failed to generate query embedding.");
        return;
      }

      const scoredMemories = [];

      // scan the REAL messages array
      messages.forEach(msg => {
        // only check user messages that have successfully stored vectors
        // include system summaries in the search
        if ((msg.sender === "user" || msg.sender === "system") && msg.vector) {
          const rawScore = cosineSimilarity(queryEmbedding, msg.vector);
          const finalScore = msg.timestamp ? applyTimeDecay(rawScore, msg.timestamp) : rawScore;
          scoredMemories.push({ id: msg.id, text: msg.text, score: finalScore });
        }
      });

      // sort and display
      scoredMemories.sort((a, b) => b.score - a.score);
      
      // grab the top 5 regardless of a threshold to visually debug weak matches
      const topMatches = scoredMemories.slice(0, 5); 
      
      console.log("[Inspector] Top matches found:", topMatches.map(m => ({ score: m.score.toFixed(3), text: m.text })));
      setPocRetrievedResults(topMatches);
      
    } catch (error) {
      console.error("[MemoryPipeline] Failure during manual retrieval:", error);
    }
  };

  // handle message send variable
  const handleSend = async () => {
    if (inputText.trim() === "") return;

    // keyboard dismissal on send
    Keyboard.dismiss();

    const currentInput = inputText;
    setIsTyping(true);

    let userVector = null;
    if (llamaContext) {
      userVector = await generateRealEmbedding(currentInput.toLowerCase(), llamaContext);
    }

    const userMsg = {
      id: Date.now().toString(),
      timestamp: Date.now().toString(),
      text: currentInput,
      sender: "user",
      vector: userVector,
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

      // real slm
      // check if the AI is actually loaded into RAM
      if (!llamaContext) {
        Alert.alert(
          "AI Not Ready",
          "Please download the model from settings and wait for it to load.",
        );
        setIsTyping(false);
        return;
      }

      try {
        // --- advanced pipeline semantic search ---
        console.log("\n--- INITIATING ADVANCED MEMORY RETRIEVAL ---");
        const scoredMemories = [];

        // define the boundary: last 8 messages are Short-Term. everything before is Long-Term
        const SHORT_TERM_LIMIT = 8;
        const longTermMemoryPool = updatedWithUser.slice(0, -SHORT_TERM_LIMIT);
        const shortTermHistory = updatedWithUser.slice(-SHORT_TERM_LIMIT);

        if (userVector) {
          const cleanQuery = removeStopWords(currentInput);
          const searchVector = await generateRealEmbedding(cleanQuery, llamaContext);

          if (searchVector) {
            // only search the long-term pool! no redundant short-term memories
            longTermMemoryPool.forEach(msg => {
              // include system summaries
              if ((msg.sender === "user" || msg.sender === "system") && msg.id !== userMsg.id && msg.vector) {
                const rawScore = cosineSimilarity(searchVector, msg.vector);
                const finalScore = msg.timestamp ? applyTimeDecay(rawScore, msg.timestamp) : rawScore;

                scoredMemories.push({ text: msg.text, rawScore, finalScore });
              }
            });
            scoredMemories.sort((a, b) => b.finalScore - a.finalScore);
          }
        }

        const topMatches = scoredMemories.filter(m => m.finalScore > 0.80).slice(0, 2);

        // --- pipeline prompt injection ---
        let formattedHistory = `${systemPrompt}\n\n`;

        if (topMatches.length > 0) {
          const memoryContext = topMatches.map(m => m.text).join(" | ");
          formattedHistory += `[SYSTEM CONTEXT: The user has previously mentioned the following relevant information: ${memoryContext}]\n\n`;
        }

        // only map the shortTermHistory to avoid crashing the 2048 token limit
        shortTermHistory.forEach((msg) => {
          if (msg.id !== "welcome") {
            const role = msg.sender === "user" ? userName : "Assistant";
            formattedHistory += `${role}: ${msg.text}\n`;
          }
        });
        formattedHistory += "Assistant:";

        // --- pipeline generate aware response ---
        console.log("[Generation] Firing SLM completion...");
        const response = await llamaContext.completion({
          prompt: formattedHistory,
          n_predict: 150, 
          temperature: 0.7, 
          stop: ["\nUser:", `\n${userName}:`, "\nAssistant:"], 
        });

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

        setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 100);

        // check if the date rolled over during the conversation
        checkAndRunConsolidation(finalMessages, llamaContext);

      } catch (error) {
        console.error("Generation error:", error);
        setIsTyping(false);
        Alert.alert("Error", "The AI failed to generate a response.");
      }
    }
  };

// start of render
  return (
    <SafeAreaProvider>
    <View
      style={[
        styles.container,
        isDarkMode && styles.darkContainer,
        { paddingBottom: keyboardHeight },
      ]}
    >
      <StatusBar barStyle={isDarkMode ? "light-content" : "dark-content"} />

      <Modal
        animationType="slide"
        transparent={true}
        visible={isPromptModalVisible}
        onRequestClose={() => setIsPromptModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, isDarkMode ? styles.darkModal : styles.lightModal]}>
            <Text style={[styles.modalTitle, isDarkMode && styles.darkText]}>AI Personality</Text>
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
            <TouchableOpacity style={[styles.resetButton, { backgroundColor: "#34C759" }]} onPress={saveSystemPrompt}>
              <Text style={styles.resetText}>Save Settings</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.closeButton} onPress={() => setIsPromptModalVisible(false)}>
              <Text style={styles.closeText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <Modal
        animationType="slide"
        transparent={true}
        visible={isVectorPOCVisible}
        onRequestClose={() => setIsVectorPOCVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, isDarkMode ? styles.darkModal : styles.lightModal, { height: '80%' }]}>
            <Text style={[styles.modalTitle, isDarkMode && styles.darkText, { marginBottom: 15 }]}>Memory Inspector</Text>
            <Text style={{ color: isDarkMode ? '#aaa' : '#666', marginBottom: 20, textAlign: 'center', fontSize: 12 }}>
              Debug Tool: Test the semantic search algorithm against your active chat history.
            </Text>
            <Text style={[styles.modalLabel, isDarkMode && styles.darkText, { alignSelf: 'flex-start', marginBottom: 5 }]}>
              Test a Query:
            </Text>
            <TextInput
              style={[styles.input, isDarkMode && styles.darkInput, { width: '100%', marginBottom: 10 }]}
              placeholder="e.g., What editor do I like?"
              placeholderTextColor={isDarkMode ? "#aaa" : "#888"}
              value={pocQueryInput}
              onChangeText={setPocQueryInput}
            />
            <TouchableOpacity style={[styles.resetButton, { backgroundColor: "#34C759" }]} onPress={handleRetrieveMemoryPOC}>
              <Text style={styles.resetText}>Run Similarity Search</Text>
            </TouchableOpacity>
            <View style={{ flex: 1, width: '100%', marginTop: 10, backgroundColor: isDarkMode ? '#3a3a3c' : '#f0f0f0', borderRadius: 10, padding: 10 }}>
              <Text style={[styles.modalLabel, isDarkMode && styles.darkText, { marginBottom: 5 }]}>Vector DB Matches:</Text>
              <ScrollView>
                {pocRetrievedResults.length === 0 ? (
                  <Text style={{ color: isDarkMode ? "#aaa" : "#666", fontStyle: 'italic' }}>No matches found or query not run yet.</Text>
                ) : (
                  pocRetrievedResults.map((item) => (
                    <View key={item.id} style={{ backgroundColor: isDarkMode ? '#2c2c2e' : '#fff', padding: 12, borderRadius: 8, marginBottom: 8 }}>
                      <Text style={{ color: isDarkMode ? '#fff' : '#000', fontStyle: 'italic', marginBottom: 4 }}>"{item.text}"</Text>
                      <Text style={{ color: item.score > 0.82 ? '#34C759' : '#ff3b30', fontSize: 12, fontWeight: 'bold' }}>
                        Match Score: {item.score.toFixed(3)}
                      </Text>
                    </View>
                  ))
                )}
              </ScrollView>
            </View>
            <TouchableOpacity style={styles.closeButton} onPress={() => setIsVectorPOCVisible(false)}>
              <Text style={styles.closeText}>Close Debugger</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <Modal visible={isConsolidating} transparent={true} animationType="fade">
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', alignItems: 'center' }}>
          <View style={{ backgroundColor: isDarkMode ? '#2c2c2e' : '#fff', padding: 25, borderRadius: 15, alignItems: 'center', elevation: 10 }}>
            <ActivityIndicator size="large" color="#34C759" />
            <Text style={{ color: isDarkMode ? '#fff' : '#000', marginTop: 15, fontSize: 16, fontWeight: 'bold' }}>
              Optimizing Memories...
            </Text>
            <Text style={{ color: isDarkMode ? '#aaa' : '#666', marginTop: 5, fontSize: 12, textAlign: 'center' }}>
              Organizing past conversations into long-term storage.
            </Text>
          </View>
        </View>
      </Modal>

      {activeScreen === "chat" ? (
        <>
          <View style={[styles.header, isDarkMode && styles.darkHeader]}>
            <View style={styles.headerLeft}>
              <Text style={[styles.title, isDarkMode && styles.darkText]}>Local AI</Text>
              <Text style={[styles.userLabel, isDarkMode ? styles.darkText : styles.lightText]}>User: {userName}</Text>
            </View>
            <View style={styles.statusContainer}>
              <Text style={[styles.statusIcon, { color: llamaContext ? '#34C759' : '#888' }]}>✓</Text>
              <Text style={[styles.statusText, { color: llamaContext ? '#34C759' : '#888' }]}>Model{"\n"}Loaded</Text>
            </View>
            <View style={styles.headerControls}>
              <TouchableOpacity onPress={() => setIsPromptModalVisible(true)} style={styles.gearButton}>
                <Text style={{ fontSize: 24 }}>{"  📝"}</Text>
              </TouchableOpacity>
              
              <TouchableOpacity onPress={() => setActiveScreen("settings")} style={styles.gearButton}>
                <Text style={{ fontSize: 24 }}>{"⚙️"}</Text>
              </TouchableOpacity>
              
              <TouchableOpacity style={styles.clearButton} onPress={clearScreenOnly}>
                <Text style={styles.clearText}>Clear Text</Text>
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
              onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: true })}
              onLayout={() => flatListRef.current?.scrollToEnd({ animated: false })}
              renderItem={({ item }) => {
                if (item.isHidden) return null;
                const shouldAnimate = item.id === animatingMessageId;
                return (
                  <View style={[styles.messageWrapper, item.sender === "user" ? styles.userWrapper : isDarkMode ? styles.darkAiWrapper : styles.aiWrapper]}>
                    {shouldAnimate ? (
                      <TypeWriterText text={item.text} style={[styles.messageText, isDarkMode ? styles.darkText : styles.aiText]} scrollViewRef={flatListRef} />
                    ) : (
                      <Text style={[styles.messageText, item.sender === "user" ? styles.userText : isDarkMode ? styles.darkText : styles.aiText]}>{item.text}</Text>
                    )}
                  </View>
                );
              }}
            />
          </TouchableWithoutFeedback>

          {isTyping && <TypingIndicator isDarkMode={isDarkMode} />}

          <View style={[styles.inputRow, isDarkMode && styles.darkHeader, { paddingBottom: keyboardHeight > 0 ? 55 : 50 }]}>
            <TextInput
              style={[styles.input, isDarkMode && styles.darkInput]}
              value={inputText}
              onChangeText={setInputText}
              placeholder="Type a message..."
              placeholderTextColor={isDarkMode ? "#aaa" : "#888"}
              multiline={true}
              onFocus={() => setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 200)}
            />
            <TouchableOpacity style={styles.sendButton} onPress={handleSend}>
              <Text style={styles.sendText}>Send</Text>
            </TouchableOpacity>
          </View>
        </>
      ) : (
        <SafeAreaView style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
          <View style={[styles.modalContent, isDarkMode ? styles.darkModal : styles.lightModal, { width: '90%', elevation: 5 }]}>
            <Text style={[styles.modalTitle, isDarkMode && styles.darkText]}>Settings</Text>

            <View style={styles.settingRow}>
              <Text style={[styles.modalLabel, isDarkMode && styles.darkText]}>Theme: {isDarkMode ? "Dark" : "Light"}</Text>
              <Switch value={isDarkMode} onValueChange={toggleTheme} trackColor={{ false: "#767577", true: "#34C759" }} />
            </View>

            <View style={styles.settingRow}>
              <Text style={[styles.modalLabel, isDarkMode && styles.darkText]}>Show Animated Logo{"\n"}on Startup</Text>
              <Switch value={playIntroVideo} onValueChange={handleToggleVideo} trackColor={{ false: "#767577", true: "#81b0ff" }} thumbColor={playIntroVideo ? "#2196F3" : "#f4f3f4"} />
            </View>

            <View style={styles.settingRow}>
              <Text style={[styles.modalLabel, isDarkMode && styles.darkText]}>Companion AI Model</Text>
              {modelReady ? (
                <Text style={{ color: "#34C759", fontWeight: "bold" }}>Installed ✓</Text>
              ) : isDownloading ? (
                <Text style={{ color: "#007AFF" }}>{downloadProgress}%</Text>
              ) : (
                <TouchableOpacity style={{ backgroundColor: "#007AFF", padding: 8, borderRadius: 8 }} onPress={downloadModel}>
                  <Text style={{ color: "#fff", fontWeight: "bold" }}>Download</Text>
                </TouchableOpacity>
              )}
            </View>

            {modelReady && (
              <View style={styles.settingRow}>
                <Text style={[styles.modalLabel, isDarkMode && styles.darkText]}>Active Brain:</Text>
                <Text style={[styles.modalLabel, { color: isDarkMode ? "#aaa" : "#666", fontSize: 14, fontWeight: "normal" }]}>{MODEL_DISPLAY_NAME}</Text>
              </View>
            )}

            <TouchableOpacity
              style={[styles.resetButton, { backgroundColor: "#8E8D8A", marginBottom: 15 }]}
              onPress={() => setIsVectorPOCVisible(true)}
            >
              <Text style={styles.resetText}>Open Vector DB Testing</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.resetButton} onPress={confirmResetProfile}>
              <Text style={styles.resetText}>Reset User Profile</Text>
            </TouchableOpacity>

            <TouchableOpacity style={[styles.resetButton, { backgroundColor: "#8b0000", marginTop: 10 }]} onPress={confirmEraseMemory}>
              <Text style={styles.resetText}>Wipe Long-Term Memory</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.closeButton} onPress={() => setActiveScreen("chat")}>
              <Text style={styles.closeText}>Return to Chat</Text>
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      )}
    </View>
    </SafeAreaProvider>
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
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  statusContainer: {
    flexDirection: "row",
    alignItems: "center",
    marginLeft: 10,
    marginTop: 2,
  },
  statusIcon: {
    fontSize: 16,
    fontWeight: "bold",
    marginRight: 4,
  },
  statusText: {
    fontSize: 10,
    fontWeight: "bold",
    lineHeight: 12,
  },
});
