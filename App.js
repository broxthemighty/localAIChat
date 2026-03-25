import React, { useState, useRef, useEffect } from 'react';
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
} from 'react-native';
//import { MMKV } from 'react-native-mmkv';

/*
 * UAT MS688 Mobile Development
 *
 * Week 2
 * Assignment 2.1
 * * Local AI core
 *
 * By Matt Lindborg
 * * Week 1 - created the core logic and main app display
 * Week 2 - added local storage capability and ux improvements
 */

// roadmap for future vector database integration:
// 1. implement text embedding: convert user input into high-dimensional vectors (e.g., via onnx runtime).
// 2. setup local vector store: integrate a mobile-compatible vector library (like sqlite-vss) to replace json-based history. (need a schema that works)
// 3. semantic search: enable the ai to "remember" context by searching the database for visually/thematically similar past messages.
// 4. context windowing: feed retrieved vector results back into the ai prompt for "long-term memory" capabilities.

// MMKV storage instance
//const storage = new MMKV();

const storage = { getString: () => null, set: () => {}, delete: () => {} };

// storage key variables
const CHAT_STORAGE_KEY = '@chat_history';
const THEME_STORAGE_KEY = '@theme_setting';
const USER_NAME_KEY = '@user_name';

// main app
export default function App() {
  // state variables
  const [messages, setMessages] = useState([]);
  const [inputText, setInputText] = useState('');
  const [userName, setUserName] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [isDarkMode, setIsDarkMode] = useState(false);
  const [isSettingsVisible, setIsSettingsVisible] = useState(false);
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  
  // list reference variable
  const flatListRef = useRef(null);

  // load chat history and listeners on startup
  useEffect(() => {
    loadInitialData();

    // keyboard listeners for dynamic height tracking
    const showSub = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow',
      (e) => setKeyboardHeight(e.endCoordinates.height)
    );
    const hideSub = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide',
      () => setKeyboardHeight(0)
    );

    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  // load all stored data variable
  const loadInitialData = () => {
    try {
      const savedTheme = storage.getString(THEME_STORAGE_KEY);
      const savedName = storage.getString(USER_NAME_KEY);
      const savedMessages = storage.getString(CHAT_STORAGE_KEY);

      if (savedTheme !== null) {
        setIsDarkMode(savedTheme === 'dark');
      }

      const currentUserName = savedName || 'Guest';
      setUserName(currentUserName);

      if (savedMessages !== null) {
        setMessages(JSON.parse(savedMessages));
      } else {
        // default welcome message using stored username
        setMessages([
          {
            id: 'welcome',
            text: `Hello, ${currentUserName}! I am your local AI. Type 'search [topic]' to search the web.`,
            sender: 'ai',
          }
        ]);
      }
    } catch (e) {
      console.error('Failed to load initial data:', e);
    }
  };

  // save history variable
  const saveChatHistory = (newMessages) => {
    try {
      storage.set(CHAT_STORAGE_KEY, JSON.stringify(newMessages));
    } catch (e) {
      console.error('Failed to save chat history:', e);
    }
  };

  // save username variable
  const saveUserName = (name) => {
    try {
      setUserName(name);
      storage.set(USER_NAME_KEY, name);
    } catch (e) {
      console.error('Failed to save username:', e);
    }
  };

  // toggle theme variable
  const toggleTheme = () => {
    try {
      const newMode = !isDarkMode;
      setIsDarkMode(newMode);
      storage.set(THEME_STORAGE_KEY, newMode ? 'dark' : 'light');
    } catch (e) {
      console.error('Failed to save theme preference:', e);
    }
  };

  // reset profile variable
  const confirmResetProfile = () => {
    Alert.alert(
      "Reset Profile",
      "This will clear your username and theme settings. Chat history will be untouched.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Reset", style: "destructive", onPress: resetProfile }
      ]
    );
  };

  // handle profile reset variable
  const resetProfile = () => {
    try {
      storage.delete(THEME_STORAGE_KEY);
      storage.delete(USER_NAME_KEY);
      setIsDarkMode(false);
      setUserName('Guest');
      setIsSettingsVisible(false);
    } catch (e) {
      console.error('Failed to reset profile:', e);
    }
  };

  // clear chat variable
  const clearChat = () => {
    try {
      storage.delete(CHAT_STORAGE_KEY);
      const resetMessage = [{
        id: Date.now().toString(),
        text: "Chat history cleared. How can I help you?",
        sender: 'ai',
      }];
      setMessages(resetMessage);
      saveChatHistory(resetMessage);
    } catch (e) {
      console.error('Failed to clear chat:', e);
    }
  };

  // duck duck go fetch variable
  const fetchDuckDuckGo = async (query) => {
    try {
      const response = await fetch(`https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json`);
      const data = await response.json();

      if (data.AbstractText) {
        return data.AbstractText;
      } else if (data.RelatedTopics && data.RelatedTopics.length > 0 && data.RelatedTopics[0].Text) {
        return data.RelatedTopics[0].Text;
      } else {
        return "I searched DuckDuckGo, but I couldn't find a quick summary for that.";
      }
    } catch (error) {
      console.error('DDG fetch error:', error);
      return "Sorry, my internet connection seems to be down.";
    }
  };

  // handle message send variable
  const handleSend = async () => {
    if (inputText.trim() === '') return;

    // keyboard dismissal on send
    Keyboard.dismiss();

    const currentInput = inputText;
    const userMsg = { 
      id: Date.now().toString(), 
      text: currentInput, 
      sender: 'user' 
    };
    
    // update state and save to storage
    const updatedWithUser = [...messages, userMsg];
    setMessages(updatedWithUser);
    saveChatHistory(updatedWithUser);
    
    setInputText('');
    setIsTyping(true);

    const lowerInput = currentInput.toLowerCase();
    
    // check for name change command
    let detectedName = null;
    if (lowerInput.startsWith("my name is ")) detectedName = currentInput.substring(11).trim();
    else if (lowerInput.startsWith("call me ")) detectedName = currentInput.substring(8).trim();

    if (detectedName) {
      await saveUserName(detectedName);
      setTimeout(() => {
        const aiMsg = {
          id: Date.now().toString(),
          text: `Got it! I've updated your name to ${detectedName}.`,
          sender: 'ai',
        };
        const final = [...updatedWithUser, aiMsg];
        setMessages(final);
        saveChatHistory(final);
        setIsTyping(false);
        // explicit scroll call
        setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 100);
      }, 1000);
      return;
    }

    const isSearchCommand = lowerInput.startsWith('search ');

    if (isSearchCommand) {
      const query = currentInput.substring(7);
      const searchResult = await fetchDuckDuckGo(query);
      
      const aiMsg = {
        id: (Date.now() + 1).toString(),
        text: `🔍 Web Search Result:\n\n${searchResult}`,
        sender: 'ai',
      };
      
      const updatedWithSearch = [...updatedWithUser, aiMsg];
      setMessages(updatedWithSearch);
      saveChatHistory(updatedWithSearch);
      setIsTyping(false);
      // explicit scroll call
      setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 100);
    } else {
      setTimeout(() => {
        const aiMsg = {
          id: (Date.now() + 1).toString(),
          text: `This is a saved simulated response, ${userName}! History will persist.`,
          sender: 'ai',
        };
        const updatedWithMock = [...updatedWithUser, aiMsg];
        setMessages(updatedWithMock);
        saveChatHistory(updatedWithMock);
        setIsTyping(false);
        // explicit scroll call
        setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 100);
      }, 1500);
    }
  };

  // start of render
  return (
    <View style={[styles.container, isDarkMode && styles.darkContainer, { paddingBottom: keyboardHeight }]}>
      <StatusBar barStyle={isDarkMode ? "light-content" : "dark-content"} />
      
      <Modal
        animationType="fade"
        transparent={true}
        visible={isSettingsVisible}
        onRequestClose={() => setIsSettingsVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, isDarkMode ? styles.darkModal : styles.lightModal]}>
            <Text style={[styles.modalTitle, isDarkMode && styles.darkText]}>Settings</Text>
            
            <View style={styles.settingRow}>
              <Text style={[styles.modalLabel, isDarkMode && styles.darkText]}>
                Theme: {isDarkMode ? 'Dark' : 'Light'}
              </Text>
              <Switch 
                value={isDarkMode} 
                onValueChange={toggleTheme}
                trackColor={{ false: "#767577", true: "#34C759" }}
              />
            </View>

            <TouchableOpacity style={styles.resetButton} onPress={confirmResetProfile}>
              <Text style={styles.resetText}>Reset User Profile</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.closeButton} onPress={() => setIsSettingsVisible(false)}>
              <Text style={styles.closeText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <View style={[styles.header, isDarkMode && styles.darkHeader]}>
        <View style={styles.headerLeft}>
          <Text style={[styles.title, isDarkMode && styles.darkText]}>Local AI</Text>
          <Text style={[styles.userLabel, isDarkMode ? styles.darkText : styles.lightText]}>
            User: {userName}
          </Text>
        </View>
        <View style={styles.headerControls}>
          <TouchableOpacity onPress={() => setIsSettingsVisible(true)} style={styles.gearButton}>
            <Text style={{fontSize: 24}}>{'⚙️'}</Text>
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
          onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: true })}
          renderItem={({ item }) => (
            <View style={[
              styles.messageWrapper,
              item.sender === 'user' ? styles.userWrapper : (isDarkMode ? styles.darkAiWrapper : styles.aiWrapper)
            ]}>
              <Text style={[styles.messageText, item.sender === 'user' ? styles.userText : (isDarkMode ? styles.darkText : styles.aiText)]}>
                {item.text}
              </Text>
            </View>
          )}
        />
      </TouchableWithoutFeedback>

      {isTyping && (
        <Text style={styles.typingIndicator}>AI is processing...</Text>
      )}

      <View style={[
        styles.inputRow, 
        isDarkMode && styles.darkHeader, 
        { paddingBottom: keyboardHeight > 0 ? 55 : 50 }
      ]}>
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
    </View>
  );
}

// style sheet
const styles = StyleSheet.create({
  container: { 
    flex: 1, 
    backgroundColor: '#f5f5f5',
  },
  darkContainer: { 
    backgroundColor: '#1c1c1e',
  },
  header: { 
    flexDirection: 'row', 
    justifyContent: 'space-between', 
    alignItems: 'center', 
    paddingTop: 50, 
    paddingHorizontal: 20, 
    paddingBottom: 10, 
    backgroundColor: '#fff', 
    borderBottomWidth: 1, 
    borderBottomColor: '#ddd',
  },
  darkHeader: { 
    backgroundColor: '#2c2c2e', 
    borderBottomColor: '#3a3a3c',
  },
  headerLeft: { 
    flex: 1,
  },
  headerControls: { 
    flexDirection: 'row', 
    alignItems: 'center',
  },
  userLabel: { 
    fontSize: 12, 
    fontWeight: 'bold', 
    marginTop: 2,
  },
  title: { 
    fontSize: 20, 
    fontWeight: 'bold', 
    color: '#333',
  },
  lightText: { 
    color: '#333',
  },
  darkText: { 
    color: '#fff',
  },
  gearButton: { 
    marginRight: 15,
  },
  clearButton: { 
    padding: 8, 
    backgroundColor: '#ff3b30', 
    borderRadius: 8,
  },
  clearText: { 
    color: '#fff', 
    fontWeight: 'bold', 
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
    maxWidth: '80%', 
    padding: 12, 
    borderRadius: 15, 
    marginBottom: 10,
  },
  userWrapper: { 
    alignSelf: 'flex-end', 
    backgroundColor: '#007AFF', 
    borderBottomRightRadius: 5,
  },
  aiWrapper: { 
    alignSelf: 'flex-start', 
    backgroundColor: '#e5e5ea', 
    borderBottomLeftRadius: 5,
  },
  darkAiWrapper: { 
    alignSelf: 'flex-start', 
    backgroundColor: '#3a3a3c', 
    borderBottomLeftRadius: 5,
  },
  messageText: { 
    fontSize: 16, 
    lineHeight: 22,
  },
  userText: { 
    color: '#fff',
  },
  aiText: { 
    color: '#000',
  },
  typingIndicator: { 
    paddingHorizontal: 20, 
    paddingBottom: 10, 
    color: '#888', 
    fontStyle: 'italic',
  },
  inputRow: { 
    flexDirection: 'row', 
    paddingHorizontal: 15,
    paddingTop: 10,
    backgroundColor: '#fff', 
    borderTopWidth: 1, 
    borderColor: '#ddd', 
    alignItems: 'center',
  },
  input: { 
    flex: 1, 
    minHeight: 40, 
    maxHeight: 100, 
    backgroundColor: '#f0f0f0', 
    borderRadius: 20, 
    paddingHorizontal: 15, 
    paddingTop: 10, 
    paddingBottom: 10, 
    fontSize: 16, 
    color: '#333',
  },
  darkInput: { 
    backgroundColor: '#3a3a3c', 
    color: '#fff',
  },
  sendButton: { 
    marginLeft: 10, 
    backgroundColor: '#111', 
    paddingHorizontal: 20, 
    paddingVertical: 10, 
    borderRadius: 20, 
    justifyContent: 'center',
  },
  sendText: { 
    color: '#fff', 
    fontWeight: 'bold', 
    fontSize: 16,
  },
  modalOverlay: { 
    flex: 1, 
    justifyContent: 'center', 
    alignItems: 'center', 
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  modalContent: { 
    width: '85%', 
    borderRadius: 25, 
    padding: 30, 
    alignItems: 'center', 
    elevation: 20,
  },
  lightModal: { 
    backgroundColor: '#fff',
  },
  darkModal: { 
    backgroundColor: '#2c2c2e',
  },
  modalTitle: { 
    fontSize: 24, 
    fontWeight: 'bold', 
    marginBottom: 25,
  },
  modalLabel: { 
    fontSize: 16, 
    fontWeight: '600',
  },
  settingRow: { 
    flexDirection: 'row', 
    alignItems: 'center', 
    justifyContent: 'space-between', 
    width: '100%', 
    marginBottom: 30,
  },
  resetButton: { 
    backgroundColor: '#ff3b30', 
    padding: 15, 
    borderRadius: 15, 
    width: '100%', 
    alignItems: 'center', 
    marginBottom: 15,
  },
  resetText: { 
    color: '#fff', 
    fontWeight: 'bold', 
    fontSize: 16,
  },
  closeButton: { 
    marginTop: 10,
  },
  closeText: { 
    color: '#007AFF', 
    fontWeight: 'bold', 
    fontSize: 17,
  },
});