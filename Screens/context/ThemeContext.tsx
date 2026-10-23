// src/context/ThemeContext.tsx
import React, { createContext, useState, useContext, useEffect, ReactNode, useCallback } from 'react';
import { ActivityIndicator, Appearance, useColorScheme, View, Text, ColorValue } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Define the shape of our theme colors
export interface ThemeColors {
  cardHighlight: string;
  card: string;
  muted: string;
  icon: any;
  buttonText: any;
  border: any;
  secondary: string;
  textSecondary: string;
  background: string;
  cardBackground: string;
  text: string;
  secondaryText: string;
  placeholderText: string;
  borderColor: string;
  shadowColor: string;
  primary: string; // Main accent color
  primaryDark: string; // Darker shade of primary
  primaryLight: string; // Lighter shade of primary (e.g., for message bubbles)
  accent: string; // Secondary accent color (e.g., for certain UI elements)
  surface: string; // Color for cards, sheets, dialogs
  textPrimary: string; // Primary text color (same as 'text' usually)
  link: string; // Color for clickable links
  error: string; // Color for error messages
  placeholder: string; // Color for placeholder elements/backgrounds
  filterButtonBackground: string;
  activeFilterBackground: string;
  activeFilterText: string;
  success: string; // Added for completeness, if you use it later
  warning: string; // Added for completeness, if you use it later
  info: string;   // Added for completeness, if you use it later
// + add these keys
inputBg: string;
inputBorder: string;

}

// Define the light and dark theme color palettes
const lightColors: ThemeColors = {
  background: '#F6F4FB',
  cardBackground: '#FFFFFF',
  surface: '#FFFFFF',
  text: '#15102B',
  textPrimary: '#15102B',
  secondaryText: '#5B5670',
  placeholderText: '#77718C',
  borderColor: '#E6E1F2',
  shadowColor: '#15102B',

  // Wiji brand: violet primary, mint accent
  primary: '#6C2BD9',
  primaryDark: '#4C1D95',
  primaryLight: '#E4D9FB',
  accent: '#0E9F87',

  link: '#5B21B6',
  error: '#B00020',
  placeholder: '#EDE9F6',

  filterButtonBackground: '#EDE9F6',
  activeFilterBackground: '#6C2BD9',
  activeFilterText: '#FFFFFF',

  success: '#16A34A',
  warning: '#D97706',
  info: '#0284C7',

  // ==== keys used by e-hailing styles ====
  icon: '#15102B',
  buttonText: '#FFFFFF',
  border: '#E6E1F2',
  card: '#FFFFFF',
  muted: '#77718C',
  cardHighlight: '#F1ECFD',
  inputBg: '#FFFFFF', // TextInput background
  inputBorder: '#B8B0D0',
  secondary: '',
  textSecondary: '#5B5670'
};

const darkColors: ThemeColors = {
  background: '#0E0B1A',
  cardBackground: '#1A1530',
  surface: '#1A1530',
  text: '#ECEAF5',
  textPrimary: '#ECEAF5',
  secondaryText: '#B9B3CC',
  placeholderText: '#8A84A3',
  borderColor: '#2C2545',
  shadowColor: '#000000',

  // Wiji brand: violet primary, mint accent
  primary: '#8B5CF6',
  primaryDark: '#6C2BD9',
  primaryLight: '#3B2380',
  accent: '#3EF0D0',

  link: '#C4B5FD',
  error: '#CF6679',
  placeholder: '#241D3A',

  filterButtonBackground: '#241D3A',
  activeFilterBackground: '#8B5CF6',
  activeFilterText: '#FFFFFF',

  success: '#66BB6A',
  warning: '#FBBF24',
  info: '#64B5F6',

  // ==== keys used by e-hailing styles ====
  icon: '#ECEAF5',
  buttonText: '#FFFFFF',
  border: '#2C2545',
  card: '#1A1530',
  muted: '#9A93B3',
  cardHighlight: '#241C40',
  inputBg: '#1A1530',
  inputBorder: '#3A3258',
  secondary: '',
  textSecondary: '#A9A3BF'
};


// Define the context type
interface ThemeContextType {
  theme: 'light' | 'dark';
  colors: ThemeColors;
  toggleTheme: () => void;
  isThemeLoading: boolean;
}

// Create the context
export const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

// Define the key for AsyncStorage
const THEME_STORAGE_KEY = '@app_theme_preference';

// Create the ThemeProvider component
interface ThemeProviderProps {
  children: ReactNode;
}

export const ThemeProvider: React.FC<ThemeProviderProps> = ({ children }) => {
  const systemColorScheme = useColorScheme();
  const [theme, setTheme] = useState<'light' | 'dark' | null>(null);
  const [isThemeLoading, setIsThemeLoading] = useState(true);

  useEffect(() => {
    const loadTheme = async () => {
      try {
        const storedTheme = await AsyncStorage.getItem(THEME_STORAGE_KEY);
        if (storedTheme === 'light' || storedTheme === 'dark') {
          setTheme(storedTheme);
        } else {
          setTheme(systemColorScheme || 'light');
        }
      } catch (e) {
        console.error("Failed to load theme from AsyncStorage:", e);
        setTheme(systemColorScheme || 'light');
      } finally {
        setIsThemeLoading(false);
      }
    };

    loadTheme();
  }, [systemColorScheme]);

  useEffect(() => {
    if (theme !== null && !isThemeLoading) {
      const saveTheme = async () => {
        try {
          await AsyncStorage.setItem(THEME_STORAGE_KEY, theme);
        } catch (e) {
          console.error("Failed to save theme to AsyncStorage:", e);
        }
      };
      saveTheme();
    }
  }, [theme, isThemeLoading]);

  useEffect(() => {
    const subscription = Appearance.addChangeListener(({ colorScheme }) => {
      if (colorScheme) {
        setTheme(colorScheme);
      }
    });
    return () => subscription.remove();
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme((prevTheme) => {
      const newTheme = prevTheme === 'light' ? 'dark' : 'light';
      return newTheme;
    });
  }, []);

  const colors = theme === 'light' ? lightColors : darkColors;

  if (isThemeLoading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: lightColors.background }}>
        <ActivityIndicator size="large" color={lightColors.primary} />
        
      </View>
    );
  }

  return (
    <ThemeContext.Provider value={{ theme: theme!, colors, toggleTheme, isThemeLoading }}>
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = () => {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
};
