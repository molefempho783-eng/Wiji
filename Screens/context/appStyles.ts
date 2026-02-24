// Screens/context/appStyles.ts
import { StyleSheet, Platform, Dimensions } from 'react-native';
import { ThemeColors } from './ThemeContext'; // Ensure this import path is correct
const { width, height } = Dimensions.get("window");

export const BOTTOM_TAB_BAR_HEIGHT = 70; // Adjust this value precisely if needed

export const SPACING = {
  xsmall: 4,
  small: 8,
  medium: 16,
  large: 24,
  xlarge: 32,
  xxlarge: 40,
};

export const FONT_SIZES = {
  xsmall: 12,
  small: 14,
  medium: 16,
  large: 18,
  xlarge: 20,
  xxlarge: 24,
  heading1: 28,
  heading2: 26,
  heading3: 20,
};

const createStyles = (colors: ThemeColors) => {
  return {
    global: StyleSheet.create({
      flex1: { flex: 1 },
      centeredContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: colors.background,
      },
      backButton: {
        padding: SPACING.xsmall,
        marginRight: SPACING.medium,
      },
      safeArea: {
        flex: 1,
        backgroundColor: colors.background,
      },
    headerContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: SPACING.medium,
    paddingHorizontal: SPACING.medium,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.background,
    marginBottom: SPACING.small,
      },
      headerTitle: {
        fontSize: FONT_SIZES.heading1,
        fontWeight: "bold",
        color: colors.text,
      },
      primaryButton: {
        backgroundColor: colors.primary,
        paddingVertical: SPACING.medium,
        paddingHorizontal: SPACING.large,
        borderRadius: SPACING.large,
        alignItems: 'center',
        justifyContent: 'center',
        minWidth: 120,
        flexDirection: 'row',
        shadowColor: colors.shadowColor,
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.2,
        shadowRadius: 6,
        elevation: 8,
        ...Platform.select({
          web: {
            cursor: 'pointer',
            boxShadow: '0px 4px 6px rgba(0,0,0,0.2)',
          }
        })
      },
      primaryButtonText: {
        color: colors.activeFilterText,
        fontSize: FONT_SIZES.large,
        fontWeight: 'bold',
      },
      loadingOverlay: {
        ...StyleSheet.absoluteFillObject,
        backgroundColor: 'rgba(0, 0, 0, 0.7)',
        justifyContent: 'center',
        alignItems: 'center',
        zIndex: 10,
      },
      loadingOverlayText: {
        marginTop: SPACING.small,
        fontSize: FONT_SIZES.medium,
        fontWeight: 'bold',
        color: colors.activeFilterText,
      },
      errorText: { // Defined here in global for wider use
        color: colors.error,
        fontSize: FONT_SIZES.medium,
        marginBottom: SPACING.medium,
        textAlign: 'center',
      },
      loginPromptText: { // Defined here in global for wider use
        color: colors.primary,
        fontSize: FONT_SIZES.medium,
        textDecorationLine: 'underline',
      },
    }),

    createGroupChatScreen: StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
  container: {
    flex: 1,
    padding: SPACING.large,
    backgroundColor: colors.background,
  },
        backButton: {
        padding: SPACING.xsmall,
        marginRight: SPACING.medium,
      },
  title: {
    fontSize: FONT_SIZES.heading2,
    color: colors.textPrimary,
    fontWeight: 'bold',
    marginBottom: SPACING.large,
    textAlign: 'center',
  },
  input: {
    backgroundColor: colors.cardBackground,
    color: colors.textPrimary,
    borderRadius: 8,
    padding: SPACING.medium,
    marginBottom: SPACING.medium,
  },
  descriptionInput: {
    height: 100,
    textAlignVertical: 'top',
  },
  createButton: {
    backgroundColor: colors.primary,
    borderRadius: 8,
    paddingVertical: SPACING.medium,
    alignItems: 'center',
  },
  createButtonText: {
    color: colors.buttonText,
    fontSize: FONT_SIZES.medium,
    fontWeight: '600',
  },
   button: {
  backgroundColor: colors.primary,
  borderRadius: 8,
  paddingVertical: SPACING.medium,
  paddingHorizontal: SPACING.large,
  alignItems: 'center',
  marginTop: SPACING.medium,
},
buttonText: {
  color: colors.buttonText,
  fontSize: FONT_SIZES.medium,
  fontWeight: '600',
},
}),

editCommunityScreen: StyleSheet.create({
  scrollViewContent: {
    flexGrow: 1,
    padding: SPACING.large,
    backgroundColor: colors.background,
  },
       backButton: {
        padding: SPACING.xsmall,
        marginRight: SPACING.medium,
      },
  header: {
    fontSize: FONT_SIZES.heading2,
    color: colors.textPrimary,
    fontWeight: 'bold',
    marginBottom: SPACING.large,
    textAlign: 'center',
  },
  logoContainer: {
    alignItems: 'center',
    marginBottom: SPACING.large,
  },
  logoImage: {
    width: 120,
    height: 120,
    borderRadius: 60,
    marginBottom: SPACING.small,
  },
  addLogoText: {
    color: colors.primary,
    fontSize: FONT_SIZES.medium,
  },
  input: {
    backgroundColor: colors.cardBackground,
    color: colors.textPrimary,
    borderRadius: 8,
    padding: SPACING.medium,
    marginBottom: SPACING.medium,
  },
  textArea: {
    height: 100,
    textAlignVertical: 'top',
  },
  saveButton: {
    backgroundColor: colors.primary,
    borderRadius: 8,
    paddingVertical: SPACING.medium,
    alignItems: 'center',
    marginTop: SPACING.large,
  },
  saveButtonText: {
    color: colors.buttonText,
    fontSize: FONT_SIZES.medium,
    fontWeight: '600',
  },
  loadingOverlayScreen: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.background,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingOverlayText: {
    marginTop: SPACING.medium,
    color: colors.textPrimary,
  },
  locationContainer: {
    marginBottom: SPACING.medium,
  },
  inputWithSuggestions: {
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
  },
  suggestionsList: {
    maxHeight: 200,
    borderWidth: 1,
    borderTopWidth: 0,
    borderBottomLeftRadius: 8,
    borderBottomRightRadius: 8,
    marginTop: -SPACING.medium,
    marginBottom: SPACING.medium,
  },
  suggestionItem: {
    padding: SPACING.medium,
    borderBottomWidth: 1,
  },
}),

communityDetailScreen: StyleSheet.create({
  scrollViewContent: {
    flexGrow: 1,
    padding: SPACING.medium,
    paddingBottom: BOTTOM_TAB_BAR_HEIGHT + SPACING.large,
    backgroundColor: colors.background,
  },
  loadingText: {
    marginTop: SPACING.medium,
    fontSize: FONT_SIZES.medium,
    color: colors.secondaryText,
    textAlign: 'center',
  },
  headerContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: SPACING.medium,
  },
  communityLogo: {
    width: 100,
    height: 100,
    borderRadius: 50,
    alignSelf: 'center',
    marginBottom: SPACING.medium,
    borderWidth: 2,
    borderColor: colors.borderColor,
    backgroundColor: colors.cardBackground,
  },
  header: {
    fontSize: FONT_SIZES.heading1,
    fontWeight: "bold",
    color: colors.text,
    flex: 1,
    textAlign: 'center',
  },
  settingsButton: {
    padding: SPACING.xsmall,
  },
  settingsIcon: {
    color: colors.primary,
  },
  description: {
    fontSize: FONT_SIZES.medium,
    color: colors.secondaryText,
    marginBottom: SPACING.medium,
    textAlign: 'center',
  },
  creatorButtonsContainer: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    marginBottom: SPACING.medium,
    paddingHorizontal: SPACING.small,
  },
  editButton: {
    flex: 1,
    backgroundColor: colors.secondary,
    padding: SPACING.small,
    borderRadius: SPACING.small,
    alignItems: 'center',
    marginRight: SPACING.small,
  },
  editButtonText: {
    color: colors.textPrimary,
    fontWeight: 'bold',
    fontSize: FONT_SIZES.medium,
  },
  deleteButton: {
    flex: 1,
    backgroundColor: colors.error,
    padding: SPACING.small,
    borderRadius: SPACING.small,
    alignItems: 'center',
    marginLeft: SPACING.small,
  },
  deleteButtonText: {
    color: colors.activeFilterText,
    fontWeight: 'bold',
    fontSize: FONT_SIZES.medium,
  },
  joinButton: {
    backgroundColor: colors.primary,
    padding: SPACING.medium,
    borderRadius: SPACING.small,
    alignItems: "center",
    marginBottom: SPACING.medium,
  },
  joinButtonText: {
    color: colors.activeFilterText,
    fontWeight: "bold",
    fontSize: FONT_SIZES.large,
  },
  subHeader: {
    fontSize: FONT_SIZES.xlarge,
    fontWeight: "bold",
    color: colors.text,
    marginBottom: SPACING.small,
    marginTop: SPACING.medium,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderColor,
    paddingBottom: SPACING.xsmall,
  },
  groupChatItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: SPACING.medium,
    backgroundColor: colors.cardBackground,
    borderRadius: SPACING.small,
    marginBottom: SPACING.small,
    borderWidth: 1,
    borderColor: colors.borderColor,
    shadowColor: colors.shadowColor,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  groupChatAvatar: {
    width: 50,
    height: 50,
    borderRadius: 25,
    marginRight: SPACING.medium,
    backgroundColor: colors.surface,
  },
  groupChatAvatarFallback: {
    width: 50,
    height: 50,
    borderRadius: 25,
    marginRight: SPACING.medium,
    backgroundColor: colors.primaryLight,
    justifyContent: 'center',
    alignItems: 'center',
  },
  groupChatAvatarText: {
    color: colors.primary,
    fontSize: FONT_SIZES.medium,
    fontWeight: 'bold',
  },
  groupChatText: {
    fontSize: FONT_SIZES.medium,
    color: colors.text,
    flex: 1,
  },
  noGroupsText: {
    textAlign: "center",
    color: colors.secondaryText,
    marginTop: SPACING.large,
  },
  createGroupButton: {
    backgroundColor: colors.accent,
    paddingVertical: SPACING.medium,
    marginTop: SPACING.medium,
  },
  createGroupButtonText: {
    color: colors.activeFilterText,
    fontWeight: 'bold',
    textAlign: 'center',
  },
  flatListContent: {
    paddingBottom: 150,
  },
  infoSection: {
    marginBottom: SPACING.medium,
    paddingHorizontal: SPACING.small,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: SPACING.small,
    gap: SPACING.small,
  },
  infoText: {
    fontSize: FONT_SIZES.medium,
    color: colors.textPrimary,
    flex: 1,
  },
  categoryTagsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: SPACING.small,
    gap: SPACING.small,
  },
  categoryTag: {
    backgroundColor: colors.primaryLight,
    paddingHorizontal: SPACING.medium,
    paddingVertical: SPACING.xsmall,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.primary,
  },
  categoryTagText: {
    fontSize: FONT_SIZES.small,
    color: colors.primary,
    fontWeight: '500',
  },
  saveButton: {
    backgroundColor: colors.accent,
    paddingVertical: SPACING.medium,
    borderRadius: SPACING.small,
    alignItems: 'center',
    marginTop: SPACING.medium,
  },
  saveButtonText: {
    color: colors.activeFilterText,
    fontWeight: 'bold',
    fontSize: FONT_SIZES.medium,
  },
}),
    communityScreen: StyleSheet.create({
      scrollView: {
        flex: 1,
        backgroundColor: colors.background,
      },
      scrollViewContent: {
        flexGrow: 1,
        paddingBottom: BOTTOM_TAB_BAR_HEIGHT + SPACING.large,
      },
      safeArea: {
        flex: 1,
        backgroundColor: colors.background,
      },
      listHeaderContainer: {
        backgroundColor: colors.background,
        paddingBottom: SPACING.medium,
      },
      headerContainer: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: SPACING.large,
        paddingHorizontal: SPACING.medium,
        paddingTop: SPACING.small,
      },
      pageTitle: {
        fontSize: FONT_SIZES.heading1,
        fontWeight: "bold",
        color: colors.text,
      },
      themeToggleContainer: {
        flexDirection: 'row',
        alignItems: 'center',
      },
      communityLogoFallback: {
          width: 60,
          height: 60,
          borderRadius: 30,
          backgroundColor: colors.primaryLight,
          justifyContent: 'center',
          alignItems: 'center',
          marginBottom: 8,
        },
        communityLogoFallbackText: {
          color: colors.primary,
          fontSize: FONT_SIZES.large,
          fontWeight: 'bold',
        },
      themeToggleText: {
        fontSize: FONT_SIZES.medium,
        marginRight: SPACING.small,
        color: colors.secondaryText,
      },
      searchBar: {
        width: "100%",
        paddingVertical: 12,
        paddingHorizontal: 15,
        borderRadius: 25,
        borderWidth: 1,
        fontSize: FONT_SIZES.medium,
        marginBottom: SPACING.large,
        backgroundColor: colors.cardBackground,
        borderColor: colors.borderColor,
        color: colors.text,
        shadowColor: colors.shadowColor,
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 3,
        elevation: 3,
        ...Platform.select({
          web: {
            boxShadow: '0 2px 3px rgba(0,0,0,0.1)',
          },
        }),
        marginHorizontal: SPACING.medium,
      },
      filterContainer: {
        flexDirection: "row",
        justifyContent: "space-around",
        marginBottom: SPACING.large + SPACING.small,
        backgroundColor: colors.cardBackground,
        borderRadius: 10,
        padding: SPACING.xsmall,
        shadowColor: colors.shadowColor,
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.05,
        shadowRadius: 2,
        elevation: 2,
        ...Platform.select({
          web: {
            boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
          },
        }),
        marginHorizontal: SPACING.medium,
      },
      filterButton: {
        flex: 1,
        paddingVertical: 10,
        marginHorizontal: 3,
        borderRadius: 8,
        alignItems: "center",
      },
      filterText: {
        fontWeight: "600",
        fontSize: FONT_SIZES.medium - 1,
      },
      activityIndicatorContainer: {
        flex: 1,
        justifyContent: "center",
        alignItems: "center",
        minHeight: 150,
      },
      loadingText: {
        marginTop: SPACING.small,
        fontSize: FONT_SIZES.medium,
        color: colors.secondaryText,
      },
      communityListRow: {
        justifyContent: "space-between",
        marginBottom: SPACING.small,
        paddingHorizontal: SPACING.medium,
      },
      communityCard: {
        flex: 1,
        margin: SPACING.small,
        padding: 15,
        backgroundColor: colors.cardBackground,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: colors.borderColor,
        alignItems: "center",
        shadowColor: colors.shadowColor,
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 4,
        elevation: 5,
        ...Platform.select({
          web: {
            boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
            flexBasis: '48%',
          },
        }),
      },
      communityLogo: {
        width: 60,
        height: 60,
        borderRadius: 30,
        marginBottom: SPACING.xsmall,
        backgroundColor: colors.placeholder,
        borderWidth: 1,
        borderColor: colors.borderColor,
      },
      communityCardTitle: {
        fontSize: FONT_SIZES.medium + 1,
        fontWeight: "bold",
        color: colors.text,
        flexShrink: 1,
        textAlign: 'left',
        marginRight: SPACING.xsmall,
      },
      communityCardDescription: {
        fontSize: FONT_SIZES.xsmall + 1,
        color: colors.secondaryText,
        textAlign: 'center',
      },
      communityCardContent: {
        flex: 1,
        width: '100%',
        marginTop: SPACING.xsmall,
        alignItems: 'flex-start',
        paddingHorizontal: SPACING.small,
        justifyContent: 'center',
      },
      userCard: {
        flexDirection: "row",
        alignItems: "center",
        paddingVertical: 12,
        paddingHorizontal: 15,
        marginBottom: SPACING.small,
        borderRadius: 10,
        borderWidth: 1,
        backgroundColor: colors.cardBackground,
        borderColor: colors.borderColor,
        shadowColor: colors.shadowColor,
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.08,
        shadowRadius: 3,
        elevation: 3,
        ...Platform.select({
          web: {
            boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
          },
        }),
        marginHorizontal: SPACING.medium,
      },
      userAvatar: {
        width: 40,
        height: 40,
        borderRadius: 20,
        marginRight: SPACING.medium,
        backgroundColor: colors.placeholder,
        borderWidth: 1,
        borderColor: colors.borderColor,
      },
      userCardUsername: {
        fontSize: FONT_SIZES.medium,
        color: colors.text,
        fontWeight: "500",
        flexShrink: 1,
        textAlign: 'left',
        marginRight: SPACING.xsmall,
      },
      lastMessagePreview: {
        fontSize: FONT_SIZES.small,
        color: colors.secondaryText,
        marginTop: SPACING.xsmall / 2,
        lineHeight: FONT_SIZES.medium,
        textAlign: 'left',
      },
      cardTimestamp: {
        fontSize: FONT_SIZES.xsmall,
        color: colors.secondaryText,
        marginLeft: 'auto',
        alignSelf: 'flex-end',
      },
      cardHeaderRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'baseline',
        width: '100%',
        marginBottom: SPACING.xsmall / 2,
      },
      userCardContent: {
        flex: 1,
        justifyContent: 'center',
      },
      userCardDescription: {
        fontSize: FONT_SIZES.small,
        color: colors.secondaryText,
        marginTop: SPACING.xsmall / 2,
        lineHeight: FONT_SIZES.medium,
      },
      noResultsText: {
        textAlign: "center",
        marginTop: SPACING.xlarge,
        fontSize: FONT_SIZES.medium,
        color: colors.secondaryText,
        paddingBottom: SPACING.large,
      },
      categoryListContainer: {
        paddingHorizontal: SPACING.medium,
        paddingVertical: SPACING.small,
        marginBottom: SPACING.medium,
      },
      categoryButton: {
        paddingHorizontal: SPACING.medium,
        paddingVertical: SPACING.small,
        borderRadius: 20,
        backgroundColor: colors.cardBackground,
        borderWidth: 1,
        borderColor: colors.borderColor,
        marginRight: SPACING.small,
        marginBottom: SPACING.small,
      },
      categoryButtonActive: {
        backgroundColor: colors.primary,
        borderColor: colors.primary,
      },
      categoryButtonText: {
        fontSize: FONT_SIZES.small,
        color: colors.textPrimary,
        fontWeight: '500',
      },
      categoryButtonTextActive: {
        color: colors.buttonText,
        fontWeight: '600',
      },
      fab: {
        position: 'absolute',
        width: 60,
        height: 60,
        alignItems: 'center',
        justifyContent: 'center',
        right: SPACING.large,
        top: 'auto',
        bottom: BOTTOM_TAB_BAR_HEIGHT + SPACING.large,
        backgroundColor: colors.primary,
        borderRadius: 30,
        elevation: 12,
        shadowColor: colors.shadowColor,
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.5,
        shadowRadius: 15,
        zIndex: 999,
      },
      fabText: {
        fontSize: FONT_SIZES.xxlarge,
        color: colors.activeFilterText,
        lineHeight: Platform.OS === 'ios' ? FONT_SIZES.xxlarge : FONT_SIZES.xxlarge + 5,
        fontWeight: 'bold',
      },
      listFooterContainer: {
        paddingVertical: SPACING.medium,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: colors.background,
      },
      noMoreItemsText: {
        fontSize: FONT_SIZES.small,
        color: colors.secondaryText,
        marginTop: SPACING.small,
      },
      flatListContentContainer: {
        paddingBottom: BOTTOM_TAB_BAR_HEIGHT + SPACING.large,
        backgroundColor: colors.background,
      },
      flatListStyle: {
        flex: 1,
        backgroundColor: colors.background,
        paddingHorizontal: SPACING.medium,
      },

         memberItem: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: SPACING.small,
        paddingVertical: SPACING.xsmall,
        paddingHorizontal: SPACING.small,
        backgroundColor: colors.background,
        borderRadius: SPACING.small,
      },
      memberAvatar: {
        width: 40,
        height: 40,
        borderRadius: 20,
        marginRight: SPACING.medium,
        backgroundColor: colors.placeholder,
        justifyContent: 'center',
        alignItems: 'center',
      },
      memberAvatarFallback: {
        backgroundColor: colors.secondary,
      },
      memberAvatarFallbackText: {
        color: colors.buttonText,
        fontSize: FONT_SIZES.medium,
        fontWeight: 'bold',
      },
      memberName: {
        fontSize: FONT_SIZES.medium,
        color: colors.textPrimary,
        fontWeight: '500',
      },
    }),

createBusinessScreen: StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
// appStyles.ts (inside createBusinessScreen)
inputGroup: {
  marginBottom: 12,
},

scrollContent: {
  flexGrow: 1,
  justifyContent: 'flex-start',
  paddingHorizontal: 16,
  paddingBottom: 32,
  paddingTop: 16,
},

  header: {
    fontSize: 24,
    fontWeight: 'bold' as const,
    color: colors.textPrimary,
    marginBottom: 16,
  },
  subHeader: {
    fontSize: 20,
    fontWeight: '600' as const,
    color: colors.textPrimary,
    marginBottom: 12,
  },
  label: {
    fontSize: 16,
    fontWeight: '500' as const,
    color: colors.textPrimary,
    marginBottom: 8,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.borderColor,
    borderRadius: 8,
    padding: 12,
    color: colors.textPrimary,
    backgroundColor: colors.cardBackground,
    marginBottom: 16,
  },
    deleteButton: {
    backgroundColor: colors.error,
    borderRadius: 8,
    paddingVertical: SPACING.medium,
    alignItems: 'center',
    marginTop: SPACING.medium,
  },
  deleteButtonText: {
    color: colors.activeFilterText,
    fontSize: FONT_SIZES.medium,
    fontWeight: '600',
  },
  textArea: {
    borderWidth: 1,
    borderColor: colors.borderColor,
    borderRadius: 8,
    padding: 12,
    color: colors.textPrimary,
    backgroundColor: colors.cardBackground,
    height: 100,
    textAlignVertical: 'top' as const,
    marginBottom: 16,
  },
picker: {
    flex: 1,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
},
  pickerStyles:{
    width:'70%',
    backgroundColor:'gray',
    color:'white'
  },

  imagePicker: {
    borderWidth: 1,
    borderColor: colors.borderColor,
    borderRadius: 8,
    padding: 12,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    backgroundColor: colors.surface,
    marginBottom: 16,
  },
businessPicker: {
  borderWidth: 1,
  borderColor: colors.borderColor,
  borderRadius: 8,
  paddingHorizontal: 12,
  backgroundColor: colors.cardBackground,
},
businessPickerDropdown: {
  borderWidth: 1,
  borderColor: colors.borderColor,
  borderRadius: 8,
  backgroundColor: colors.surface,
},
  imagePickerButton: {
    borderWidth: 1,
    borderColor: colors.borderColor,
    borderRadius: 8,
    padding: 12,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    backgroundColor: colors.surface,
    marginBottom: 16,
  },
  imagePreview: {
    width: '100%',
    height: 200,
    borderRadius: 8,
    marginBottom: 16,
  },
  sectionHeader: {
    fontSize: 20,
    fontWeight: 'bold' as const,
    color: colors.textPrimary,
    marginTop: 24,
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: 'bold' as const,
    color: colors.textPrimary,
    marginTop: 24,
    marginBottom: 12,
  },
  catalogItem: {
    borderWidth: 1,
    borderColor: colors.borderColor,
    borderRadius: 8,
    padding: 12,
    marginBottom: 16,
  },
  catalogItemHeader: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    marginBottom: 8,
  },
  catalogImage: {
    width: 60,
    height: 60,
    borderRadius: 8,
    marginRight: 12,
  },
  catalogInfo: {
    flex: 1,
  },
  catalogItemImage: {
    width: 60,
    height: 60,
    borderRadius: 8,
    marginRight: 12,
  },
  catalogItemTextContainer: {
    flex: 1,
  },
  catalogItemName: {
    fontSize: 16,
    fontWeight: 'bold' as const,
    color: colors.textPrimary,
  },
  catalogName: {
    fontSize: 16,
    fontWeight: 'bold' as const,
    color: colors.textPrimary,
  },
  catalogItemPrice: {
    fontSize: 14,
    color: colors.secondaryText,
  },
  catalogItemDescription: {
    fontSize: 14,
    color: colors.secondaryText,
    marginTop: 4,
  },
  catalogDescription: {
    fontSize: 14,
    color: colors.secondaryText,
    marginTop: 4,
  },
  addButton: {
    marginTop: 16,
    backgroundColor: colors.primary,
    padding: 12,
    borderRadius: 8,
    alignItems: 'center' as const,
  },
  addButtonText: {
    color: colors.activeFilterText,
    fontWeight: 'bold' as const,
    fontSize: 16,
  },
  saveButton: {
    marginTop: 24,
    backgroundColor: colors.accent,
    padding: 16,
    borderRadius: 8,
    alignItems: 'center' as const,
  },
  saveButtonText: {
    color: colors.activeFilterText,
    fontWeight: 'bold' as const,
    fontSize: 18,
  },
  submitButton: {
    marginTop: 24,
    backgroundColor: colors.primary,
    padding: 16,
    borderRadius: 8,
    alignItems: 'center' as const,
  },
  submitButtonText: {
    color: colors.activeFilterText,
    fontWeight: 'bold' as const,
    fontSize: 18,
  },
  loading: {
    marginVertical: 12,
  },
}),

addCatalogScreen: StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    padding: 16,
  },
  scrollContent: {
    paddingBottom: 32,
    paddingTop: 16,
    flexGrow: 1,
  },
  header: {
    fontSize: 24,
    fontWeight: 'bold' as const,
    color: colors.textPrimary,
    marginBottom: 16,
  },
  subHeader: {
    fontSize: 20,
    fontWeight: '600' as const,
    color: colors.textPrimary,
    marginBottom: 12,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.borderColor,
    borderRadius: 8,
    padding: 12,
    color: colors.textPrimary,
    backgroundColor: colors.cardBackground,
    marginBottom: 16,
  },
  imagePickerButton: {
    borderWidth: 1,
    borderColor: colors.borderColor,
    borderRadius: 8,
    padding: 12,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    backgroundColor: colors.surface,
    marginBottom: 16,
  },
  imagePreview: {
    width: '100%',
    height: 200,
    borderRadius: 8,
    marginBottom: 16,
  },
  catalogItem: {
    borderWidth: 1,
    borderColor: colors.borderColor,
    borderRadius: 8,
    padding: 12,
    marginBottom: 16,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
  },
  catalogItemImage: {
    width: 60,
    height: 60,
    borderRadius: 8,
    marginRight: 12,
  },
  catalogItemTextContainer: {
    flex: 1,
  },
  catalogItemName: {
    fontSize: 16,
    fontWeight: 'bold' as const,
    color: colors.textPrimary,
  },
  catalogItemDescription: {
    fontSize: 14,
    color: colors.secondaryText,
    marginTop: 4,
  },
  addButton: {
    marginTop: 16,
    backgroundColor: colors.primary,
    padding: 12,
    borderRadius: 8,
    alignItems: 'center' as const,
  },
  addButtonText: {
    color: colors.activeFilterText,
    fontWeight: 'bold' as const,
    fontSize: 16,
  },
  saveButton: {
    marginTop: 24,
    backgroundColor: colors.accent,
    padding: 16,
    borderRadius: 8,
    alignItems: 'center' as const,
  },
  saveButtonText: {
    color: colors.activeFilterText,
    fontWeight: 'bold' as const,
    fontSize: 18,
  },
}),



businessesScreen: StyleSheet.create({
  scrollView: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scrollViewContent: {
    flexGrow: 1,
    paddingBottom: BOTTOM_TAB_BAR_HEIGHT + SPACING.large, // Adjust padding for FAB and bottom bar
  },
  safeArea: { // Often handled by global.safeArea, but explicitly defined here too
    flex: 1,
    backgroundColor: colors.background,
  },
  headerContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: SPACING.large,
    paddingHorizontal: SPACING.medium,
    paddingTop: SPACING.medium, // Adjust for status bar if not using SafeAreaView always
  },
  pageTitle: {
    fontSize: FONT_SIZES.heading1,
    fontWeight: "bold",
    color: colors.textPrimary,
  },
  themeToggleContainer: { // If theme toggle lives here
    flexDirection: 'row',
    alignItems: 'center',
  },
  themeToggleText: {
    fontSize: FONT_SIZES.medium,
    marginRight: SPACING.small,
    color: colors.textSecondary,
  },
  searchContainer: {
    paddingHorizontal: SPACING.medium,
    paddingTop: SPACING.medium,
    paddingBottom: SPACING.small,
  },
  searchBarContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.cardBackground,
    borderRadius: 28,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: SPACING.medium,
    ...Platform.select({
      ios: {
        shadowColor: colors.shadowColor,
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 4,
      },
      android: {
        elevation: 3,
      },
      web: {
        boxShadow: `0 2px 4px ${colors.shadowColor}1A`,
      },
    }),
  },
  searchIcon: {
    marginRight: SPACING.small,
  },
  searchBar: {
    flex: 1,
    paddingVertical: SPACING.medium,
    fontSize: FONT_SIZES.medium,
    color: colors.textPrimary,
  },
  clearButton: {
    marginLeft: SPACING.small,
    padding: 2,
  },
  locationBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primaryLight,
    marginHorizontal: SPACING.medium,
    marginTop: SPACING.small,
    marginBottom: SPACING.medium,
    paddingVertical: SPACING.small,
    paddingHorizontal: SPACING.medium,
    borderRadius: 20,
    gap: SPACING.xsmall,
  },
  locationText: {
    fontSize: FONT_SIZES.small,
    color: colors.textSecondary,
  },
  locationCity: {
    fontWeight: '700',
    color: colors.primary,
  },
  errorContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.cardBackground,
    marginHorizontal: SPACING.medium,
    marginTop: SPACING.medium,
    padding: SPACING.medium,
    borderRadius: 12,
    borderLeftWidth: 4,
    borderLeftColor: colors.error || '#ff4444',
    gap: SPACING.small,
  },
  errorText: {
    flex: 1,
    fontSize: FONT_SIZES.medium,
    color: colors.error || '#ff4444',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: SPACING.xxlarge * 2,
  },
  loadingText: {
    marginTop: SPACING.medium,
    fontSize: FONT_SIZES.medium,
    color: colors.secondaryText,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: SPACING.xxlarge * 2,
    paddingHorizontal: SPACING.large,
  },
  emptyTitle: {
    fontSize: FONT_SIZES.large,
    fontWeight: '700',
    color: colors.textPrimary,
    marginTop: SPACING.medium,
    marginBottom: SPACING.small,
  },
  emptySubtitle: {
    fontSize: FONT_SIZES.medium,
    color: colors.secondaryText,
    textAlign: 'center',
    lineHeight: 22,
  },
  filterContainer: {
    flexDirection: "row",
    justifyContent: "space-around",
    alignItems: 'center',
    marginBottom: SPACING.large,
    paddingHorizontal: SPACING.medium,
  },
  filterLabel: {
    fontSize: FONT_SIZES.medium,
    color: colors.textSecondary,
    marginRight: SPACING.small,
  },
  dropdownButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.cardBackground,
    borderRadius: SPACING.small,
    paddingVertical: SPACING.small,
    paddingHorizontal: SPACING.medium,
    borderWidth: 1,
    borderColor: colors.border,
    minWidth: 120, // Give some minimum width
    justifyContent: 'space-between',
    marginHorizontal: SPACING.xsmall,
  },
  dropdownButtonText: {
    fontSize: FONT_SIZES.medium,
    color: colors.textPrimary,
    marginRight: SPACING.xsmall,
  },
  flatListContent: { // Content style for the FlatList itself
    paddingHorizontal: SPACING.medium,
    paddingBottom: SPACING.large, // Padding at the bottom of the list
  },
  flatListStyle: {
    flex: 1, // Allow FlatList to grow
  },
  activityIndicatorContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    minHeight: 150, // Give some height for loading indicator
  },
  noResultsText: {
    textAlign: "center",
    marginTop: SPACING.xlarge,
    fontSize: FONT_SIZES.medium,
    color: colors.secondaryText,
    paddingBottom: SPACING.large,
  },
  tabContainer: {
  flexDirection: 'row',
  justifyContent: 'space-around',
  marginBottom: SPACING.medium,
},

tabButton: {
  paddingVertical: SPACING.small,
  paddingHorizontal: SPACING.large,
  backgroundColor: colors.cardBackground,
  borderRadius: 8,
},

activeTab: {
  backgroundColor: colors.primary,
},

tabText: {
  color: colors.text,
},
tabBar: {
  backgroundColor: colors.background,
},
tabLabel: {
  fontWeight: 'bold',
  fontSize: FONT_SIZES.medium,
},
tabIndicator: {
  backgroundColor: colors.primary,
  height: 3,
},

  businessCard: { // Style for each business item in the list
  flexDirection: 'row',
  alignItems: 'center',
  backgroundColor: colors.cardBackground,
  borderRadius: 20,
  padding: 16,
  marginHorizontal: SPACING.medium,
  marginBottom: SPACING.medium,
  ...Platform.select({
    ios: {
      shadowColor: colors.shadowColor,
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.12,
      shadowRadius: 8,
    },
    android: {
      elevation: 4,
    },
    web: {
      boxShadow: `0 4px 8px ${colors.shadowColor}20`,
    },
  }),
},
 


businessImageContainer: {
  width: 80,
  height: 80,
  borderRadius: 18,
  overflow: 'hidden',
  backgroundColor: colors.surface,
  justifyContent: 'center',
  alignItems: 'center',
  marginRight: SPACING.medium,
  ...Platform.select({
    ios: {
      shadowColor: colors.shadowColor,
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.1,
      shadowRadius: 4,
    },
    android: {
      elevation: 2,
    },
  }),
},

businessImage: {
  width: '100%',
  height: '100%',
  resizeMode: 'cover',
},

businessInitialsFallback: {
  width: '100%',
  height: '100%',
  backgroundColor: colors.primaryLight,
  justifyContent: 'center',
  alignItems: 'center',
  borderRadius: 18,
},

businessInitialsText: {
  color: colors.primary,
  fontWeight: 'bold',
  fontSize: 26,
},

businessInfo: {
  flex: 1,
},

businessName: {
  fontSize: FONT_SIZES.large + 1,
  fontWeight: '700',
  color: colors.textPrimary,
  marginBottom: SPACING.xsmall,
  letterSpacing: 0.2,
},

businessDescription: {
  color: colors.secondaryText,
  fontSize: FONT_SIZES.medium,
  marginBottom: SPACING.small,
  lineHeight: 20,
},

metaRow: {
  flexDirection: 'row',
  alignItems: 'center',
  marginTop: SPACING.xsmall,
  gap: SPACING.small,
  flexWrap: 'wrap',
},

metaChip: {
  flexDirection: 'row',
  alignItems: 'center',
  backgroundColor: colors.primaryLight,
  paddingHorizontal: SPACING.small,
  paddingVertical: 4,
  borderRadius: 12,
  gap: 4,
},

metaText: {
  color: colors.primary,
  fontSize: FONT_SIZES.small,
  fontWeight: '500',
  maxWidth: 100,
},

businessMeta: {
  color: colors.secondaryText,
  fontSize: FONT_SIZES.small,
  marginLeft: 4,
  marginRight: 6,
  maxWidth: 90,
},

chevronContainer: {
  marginLeft: SPACING.small,
  justifyContent: 'center',
  alignItems: 'center',
},

  fab: { // Floating Action Button
    position: 'absolute',
    bottom: BOTTOM_TAB_BAR_HEIGHT + SPACING.large, // Position above the tab bar
    right: SPACING.large,
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: colors.primary, // Primary color for FAB
    justifyContent: 'center',
    alignItems: 'center',
    ...Platform.select({
      ios: {
        shadowColor: colors.shadowColor,
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3,
        shadowRadius: 5,
      },
      android: {
        elevation: 20, // Android elevation
      },
      web: {
        boxShadow: `0px 4px 5px ${colors.shadowColor}4D`, // Web boxShadow
      },
    }),
    zIndex: 1000, // Ensure it's on top
  },
}),



    createCommunityScreen: StyleSheet.create({
      container: {
        flex: 1,
        padding: SPACING.large,
        backgroundColor: colors.background,
      },
      header: {
        fontSize: FONT_SIZES.heading2,
        fontWeight: "bold",
        marginBottom: SPACING.medium,
        color: colors.text,
        textAlign: 'center',
      },
      logoContainer: {
        alignItems: 'center',
        marginBottom: SPACING.large,
      },
      logoImage: {
        width: 120,
        height: 120,
        borderRadius: 60,
        borderWidth: 2,
        borderColor: colors.borderColor,
        backgroundColor: colors.cardBackground,
      },
      addLogoText: {
        color: colors.primary,
        fontSize: FONT_SIZES.medium,
        fontWeight: '600',
        marginTop: SPACING.small,
      },
      input: {
        height: 50,
        backgroundColor: colors.cardBackground,
        paddingHorizontal: SPACING.small,
        borderRadius: SPACING.small,
        marginBottom: SPACING.medium,
        borderWidth: 1,
        borderColor: colors.borderColor,
        fontSize: FONT_SIZES.medium,
        color: colors.text,
        shadowColor: colors.shadowColor,
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.1,
        shadowRadius: 2,
        elevation: 2,
      },
      textArea: {
        height: 100,
        textAlignVertical: "top",
      },
      saveButton: {
        backgroundColor: colors.primary,
        padding: SPACING.medium,
        alignItems: "center",
        borderRadius: SPACING.small,
        marginTop: SPACING.medium,
        shadowColor: colors.shadowColor,
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.2,
        shadowRadius: 6,
        elevation: 8,
      },
      saveButtonText: {
        color: colors.activeFilterText,
        fontWeight: "bold",
        fontSize: FONT_SIZES.large,
      },
      loadingOverlayScreen: {
        ...StyleSheet.absoluteFillObject,
        backgroundColor: colors.background,
        justifyContent: 'center',
        alignItems: 'center',
        zIndex: 999,
      },
      loadingOverlayText: {
        marginTop: SPACING.medium,
        fontSize: FONT_SIZES.medium,
        color: colors.text,
      },
    }),

userprofileScreen: StyleSheet.create({

      scrollViewContent: {
        flexGrow: 1,
        padding: SPACING.large,
        paddingBottom: BOTTOM_TAB_BAR_HEIGHT + SPACING.xxlarge,
        backgroundColor: colors.background,
      },
  
  loadingText: {
    marginTop: SPACING.medium,
    color: colors.textPrimary,
    fontSize: FONT_SIZES.medium,
  },
  errorText: {
    color: colors.error,
    fontSize: FONT_SIZES.medium,
    textAlign: 'center',
    margin: SPACING.medium,
  },
  
  profileImage: {
    
    width: 140,
    height: 140,
    borderRadius: 70,
    marginBottom: SPACING.large,
    backgroundColor: colors.cardBackground,
  },
   profilePicContainer: {
        alignItems: "center",
        marginBottom: SPACING.xlarge,
      },
      profilePic: {
        width: 130,
        height: 130,
        borderRadius: 65,
        borderWidth: 3,
        backgroundColor: colors.cardBackground,
      },
  username: {
    fontSize: FONT_SIZES.heading2,
    fontWeight: 'bold',
    color: colors.textPrimary,
    marginBottom: SPACING.large,
    textAlign: 'center',
  },
  sectionContainer: {
    width: '100%',
    backgroundColor: colors.cardBackground,
    borderRadius: 8,
    padding: SPACING.medium,
    marginBottom: SPACING.large,
  },
  sectionHeader: {
    fontSize: FONT_SIZES.large,
    fontWeight: 'bold',
    color: colors.primary,
    marginBottom: SPACING.small,
  },
  bioText: {
    fontSize: FONT_SIZES.medium,
    color: colors.textSecondary,
  },
  linkText: {
    fontSize: FONT_SIZES.medium,
    color: colors.link,
    textDecorationLine: 'underline',
  },
  photosSection: {
    width: '100%',
    marginBottom: SPACING.large,
  },
  photosGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  photoGridItem: {
    borderRadius: 12,
    backgroundColor: colors.cardBackground,
    overflow: 'hidden',
  },
}),


    profileScreen: StyleSheet.create({
      safeArea: {
        flex: 1,
        backgroundColor: colors.background,
      },
      scrollViewContent: {
        flexGrow: 1,
        padding: SPACING.large,
        paddingBottom: BOTTOM_TAB_BAR_HEIGHT + SPACING.xxlarge,
      },
      loadingScreen: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: colors.background,
      },
      loadingScreenText: {
        marginTop: SPACING.small,
        fontSize: FONT_SIZES.medium,
        fontWeight: 'bold',
        color: colors.text,
      },
      headerContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: SPACING.medium,
    paddingHorizontal: SPACING.medium,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.background,
    marginBottom: SPACING.small,
      },
      headerTitle: {
        fontSize: FONT_SIZES.heading1,
        fontWeight: "bold",
        color: colors.text,
      },
      profilePicContainer: {
        alignItems: "center",
        marginBottom: SPACING.xlarge,
      },
      profilePic: {
        width: 130,
        height: 130,
        borderRadius: 65,
        borderWidth: 3,
        backgroundColor: colors.cardBackground,
      },
      changePicText: {
        marginTop: SPACING.small,
        fontSize: FONT_SIZES.medium,
        fontWeight: "600",
        color: colors.primary,
      },
      progressCard: {
        marginBottom: SPACING.large,
        padding: SPACING.medium,
        borderRadius: 12,
        borderWidth: 1,
      },
      progressHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: SPACING.small,
      },
      progressTitle: {
        fontSize: FONT_SIZES.medium,
        fontWeight: '600',
      },
      progressCount: {
        fontSize: FONT_SIZES.medium,
        fontWeight: '700',
      },
      progressBarBg: {
        height: 6,
        borderRadius: 3,
        overflow: 'hidden',
        marginBottom: SPACING.medium,
      },
      progressBarFill: {
        height: '100%',
        borderRadius: 3,
      },
      progressSteps: {
        gap: 6,
      },
      progressStepRow: {
        flexDirection: 'row',
        alignItems: 'center',
      },
      progressStepDot: {
        width: 20,
        height: 20,
        borderRadius: 10,
        marginRight: 8,
        justifyContent: 'center',
        alignItems: 'center',
      },
      progressStepLabel: {
        fontSize: FONT_SIZES.small,
      },
      gallerySection: {
        marginBottom: SPACING.large,
        width: '100%',
      },
      galleryGrid: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 10,
      },
      gallerySlot: {
        width: '31%',
        aspectRatio: 1,
        borderRadius: 12,
        borderWidth: 1,
        justifyContent: 'center',
        alignItems: 'center',
        overflow: 'hidden',
      },
      galleryImage: {
        ...StyleSheet.absoluteFillObject,
      },
      galleryRemove: {
        position: 'absolute',
        top: 4,
        right: 4,
        width: 24,
        height: 24,
        borderRadius: 12,
        justifyContent: 'center',
        alignItems: 'center',
      },
      inputSection: {
        marginBottom: SPACING.large,
        width: '100%',
      },
      label: {
        fontSize: FONT_SIZES.medium,
        color: colors.text,
        marginBottom: SPACING.small,
        fontWeight: '600',
      },
      textInput: {
        borderRadius: SPACING.small,
        paddingVertical: SPACING.small + 2,
        paddingHorizontal: SPACING.medium,
        fontSize: FONT_SIZES.medium,
        borderWidth: 1,
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 3,
        elevation: 4,
        backgroundColor: colors.cardBackground,
        borderColor: colors.borderColor,
        color: colors.text,
        shadowColor: colors.shadowColor,
        ...Platform.select({
          web: {
            boxShadow: '0px 2px 3px rgba(0,0,0,0.1)',
          }
        })
      },
      aboutMeInput: {
        height: 120,
        textAlignVertical: "top",
        lineHeight: FONT_SIZES.xlarge,
      },
      saveButton: {
        marginTop: SPACING.xlarge,
        backgroundColor: colors.primary,
        paddingVertical: SPACING.medium,
        borderRadius: SPACING.large,
        alignItems: "center",
        justifyContent: "center",
        shadowOffset: { width: 0, height: 6 },
        shadowOpacity: 0.3,
        shadowRadius: 8,
        elevation: 12,
        shadowColor: colors.shadowColor,
        ...Platform.select({
          web: {
            cursor: 'pointer',
            boxShadow: '0px 6px 8px rgba(0,0,0,0.3)',
          }
        })
      },
      saveButtonText: {
        fontSize: FONT_SIZES.large,
        fontWeight: "bold",
        letterSpacing: 0.5,
        color: colors.activeFilterText,
      },
    }),

    // Inside createStyles function in Screens/context/appStyles.ts
bottomTabsNavigator: StyleSheet.create({

  fab: {
    position: "absolute",
    bottom: SPACING.medium * 1.5, // Adjusted from 25 to use SPACING
    alignSelf: "center",
    width: 54,
    height: 54,
    borderRadius: 27, // Half of width/height
    backgroundColor: colors.primary,
    ...Platform.select({
      ios: { shadowColor: colors.shadowColor, shadowOffset: { width: 0, height: 5 }, shadowOpacity: 0.3, shadowRadius: 6.27 },
      android: { elevation: 10 },
      web: { boxShadow: `0px 5px 6.27px ${colors.shadowColor}4D` },
    }),
    justifyContent: "center",
    alignItems: "center",
    zIndex: 999,
  },
  fabText: {
    fontSize: FONT_SIZES.xxlarge,
    color: colors.buttonText, // Use colors.buttonText
    fontWeight: "bold",
  },
  fabSpacer: {
    width: 60, // Equal to FAB width for spacing
  },
  tabButton: { // General style for each tab icon/text wrapper
    alignItems: "center",
    justifyContent: "center",
    flex: 1,
    paddingVertical: SPACING.small, // Add some vertical padding
  },
  tabText: { // Style for the text label below the icon (if tabBarShowLabel was true)
    color: colors.secondaryText, // Default color for inactive tab text
    fontSize: FONT_SIZES.xsmall,
    marginTop: SPACING.small,
  },
}),

    groupChatScreen: StyleSheet.create({
      safeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
  container: {
    flex: 1,
    position: 'relative',
  },
  mediaPreviewText: {
  color: colors.primary,
  fontWeight: "600",
  textDecorationLine: "underline",
  fontSize: FONT_SIZES.medium,
  marginVertical: 4,
},

        attachmentButton: {
        minHeight: 40,
        padding: SPACING.small,
        borderRadius: SPACING.medium,
        backgroundColor: colors.primaryLight,
        marginRight: SPACING.small,
        alignItems: 'center',
        justifyContent: 'center',
      },
      attachmentButtonText: {
        fontSize: FONT_SIZES.large,
      },
      attachmentModalBackdrop: {
        flex: 1,
        justifyContent: 'flex-end',
        backgroundColor: 'rgba(0, 0, 0, 0.5)',
      },
      attachmentOption: {
        alignItems: 'center',
        justifyContent: 'center',
        padding: SPACING.small,
        minWidth: 80,
      },
      attachmentOptionText: {
        fontSize: FONT_SIZES.small,
        color: colors.textPrimary,
        marginTop: SPACING.xsmall,
      },
  headerContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: SPACING.medium,
    paddingHorizontal: SPACING.medium,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.background,
    marginBottom: SPACING.small,
  },
  backButton: {
    padding: SPACING.xsmall,
    marginRight: SPACING.small,
  },
  emojiButton: {
  paddingHorizontal: 8,
  justifyContent: 'center',
  alignItems: 'center',
},
emojiButtonText: {
  fontSize: 24,
},

emojiPickerContainer: {
  backgroundColor: colors.cardBackground,
  padding: SPACING.small,
  borderTopWidth: 1,
  borderColor: colors.borderColor,
  maxHeight: 200,
},

emojiPickerScroll: {
  flexDirection: 'row',
  flexWrap: 'wrap',
  justifyContent: 'flex-start',
},

emojiItem: {
  padding: 6,
  margin: 2,
  borderRadius: 6,
  backgroundColor: colors.cardBackground,
},

emojiText: {
  fontSize: 24,
},

  headerAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    marginRight: SPACING.small,
    backgroundColor: colors.secondary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerAvatarFallback: {
    backgroundColor: colors.primary,
  },
  headerAvatarFallbackText: {
    color: colors.buttonText,
    fontSize: FONT_SIZES.large,
    fontWeight: 'bold',
  },
  headerTitle: {
    fontSize: FONT_SIZES.large,
    fontWeight: "bold",
    color: colors.textPrimary,
    flex: 1,
  },
  groupDetailsButton: {
    padding: SPACING.xsmall,
    marginLeft: SPACING.small,
  },
  messageScrollView: {
    flex: 1,
  },
  messageList: {
    flexGrow: 1,
    paddingVertical: SPACING.small,
    paddingHorizontal: SPACING.small,
    paddingBottom: SPACING.xlarge * 2, // Adjust as needed for input area
  },
  messageBubbleWrapper: { // Wrapper for avatar + message bubble
    flexDirection: 'row',
    alignItems: 'flex-end',
    marginBottom: SPACING.xsmall,
    paddingHorizontal: SPACING.small,
    maxWidth: '100%',
  },
  myMessageBubbleWrapper: {
    alignSelf: 'flex-end', // Align own messages to the right
    justifyContent: 'flex-end',
  },
  otherMessageBubbleWrapper: {
    alignSelf: 'flex-start', // Align other messages to the left
    justifyContent: 'flex-start',
  },
  avatarContainer: {
    marginRight: SPACING.xsmall,
    justifyContent: 'flex-end',
  },
  messageAvatar: { // Avatar next to messages
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.placeholder, // Fallback
    borderWidth: 0.5,
    borderColor: colors.border,
  },
  messageAvatarFallback: { // Styles for the fallback avatar (initials)
    backgroundColor: colors.secondary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  messageAvatarFallbackText: {
    color: colors.buttonText,
    fontSize: FONT_SIZES.small,
    fontWeight: 'bold',
  },
  messageContainer: { // The actual message bubble content container
    paddingVertical: SPACING.small,
    paddingHorizontal: SPACING.medium,
    borderRadius: 8,
    flexShrink: 1, // Allows bubble to shrink
    maxWidth: '75%',
    minWidth: 60,
  },
  myMessageContainer: {
    backgroundColor: colors.primary, // Primary color for own messages
    borderBottomRightRadius: 4, // WhatsApp style
  },
  otherMessageContainer: {
    backgroundColor: colors.cardBackground, // Card background for others' messages
    borderBottomLeftRadius: 4, // WhatsApp style
  },
  sender: { // Sender name above message (legacy)
    fontWeight: "bold",
    color: colors.textSecondary,
    marginBottom: SPACING.small,
  },
  senderName: { // Sender name for WhatsApp style
    fontSize: FONT_SIZES.small,
    fontWeight: "600",
    color: colors.primary,
    marginBottom: SPACING.xsmall,
  },
  message: { // Text within the message bubble (legacy)
    fontSize: FONT_SIZES.medium,
    color: colors.textPrimary,
  },
  messageText: { // Base text style
    fontSize: FONT_SIZES.medium,
    lineHeight: FONT_SIZES.medium * 1.4,
  },
  otherMessageText: { // Text color for others' messages
    color: colors.textPrimary,
  },
  myMessageText: { // Text color for own messages
    color: colors.buttonText,
  },
  timestamp: { // Base timestamp style
    fontSize: FONT_SIZES.xsmall,
    marginTop: SPACING.xsmall,
    alignSelf: 'flex-end',
  },
  myMessageTimestamp: { // Timestamp for own messages
    color: 'rgba(255, 255, 255, 0.7)',
  },
  otherMessageTimestamp: { // Timestamp for others' messages
    color: colors.textSecondary,
  },

  // Media and File specific styles
  mediaMessageImage: {
    width: Dimensions.get('window').width * 0.6, // Adjust width as needed
    height: Dimensions.get('window').width * 0.45, // Maintain aspect ratio
    borderRadius: SPACING.medium,
    marginBottom: SPACING.xsmall,
    resizeMode: 'cover',
  },
  videoMessageContainer: {
    position: 'relative',
    borderRadius: SPACING.medium,
    overflow: 'hidden', // Ensures video thumbnail doesn't overflow
  },
  videoPlayText: {
    color: colors.buttonText,
    fontSize: FONT_SIZES.medium,
    textAlign: 'center',
    position: 'absolute',
    top: 0,
    left: 0,
    width: '100%',
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.4)', // Dark overlay
    borderRadius: SPACING.medium,
  },
  fileMessageContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: SPACING.small,
    backgroundColor: colors.background, // Background for file bubble
    borderRadius: SPACING.medium,
    borderWidth: 1,
    borderColor: colors.border,
  },
  fileIcon: { // Icon for file messages (e.g., from Ionicons)
    marginRight: SPACING.small,
  },
  fileDetails: { // Container for file name and size
    flex: 1,
  },
  fileNameText: {
    fontSize: FONT_SIZES.medium,
    fontWeight: 'bold',
    color: colors.textPrimary,
  },
  fileSizeText: {
    fontSize: FONT_SIZES.small,
    color: colors.textSecondary,
  },

  // Upload progress indicators
  uploadProgressBarContainer: {
    width: '100%',
    height: SPACING.xsmall, // Thin progress bar
    backgroundColor: colors.borderColor,
    borderRadius: SPACING.xsmall / 2,
    overflow: 'hidden',
    marginTop: SPACING.xsmall,
  },
  uploadProgressBar: {
    height: '100%',
    backgroundColor: colors.primary, // Progress bar color
    borderRadius: SPACING.xsmall / 2,
  },
  uploadProgressText: {
    fontSize: FONT_SIZES.xsmall,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: SPACING.xsmall / 2,
  },
  messageErrorBubble: { // Style for messages that failed to upload
    backgroundColor: colors.error + '33', // Lighter error color with transparency
    borderColor: colors.error,
    borderWidth: 1,
  },
  uploadErrorText: {
    fontSize: FONT_SIZES.small,
    color: colors.error,
    marginTop: SPACING.xsmall,
  },

inputContainer: {
  flexDirection: 'row',
  alignItems: 'center',
  padding: 8,
  backgroundColor: colors.cardBackground,
  borderTopWidth: 1,
  borderTopColor: colors.borderColor,
  elevation: 2,
},
  input: { // Main text input field
    flex: 1,
    minHeight: 40,
    paddingVertical: SPACING.small,
    paddingHorizontal: SPACING.medium,
    borderWidth: 1,
    borderRadius: 20, // Rounded corners
    borderColor: colors.border,
    color: colors.textPrimary,
    backgroundColor: colors.cardBackground, // Input field background
  },
  sendButton: { // Send button
    minHeight: 40,
    marginLeft: SPACING.small,
    backgroundColor: colors.primary,
    paddingVertical: SPACING.small,
    paddingHorizontal: SPACING.medium,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  sendButtonText: {
    color: colors.buttonText,
    fontWeight: "bold",
  },

  // Attachment options container (popping up above input)
  attachmentOptionsContainer: {
    position: 'absolute',
    bottom: '100%', // Position directly above inputContainer
    width: '100%',
    left: 0,
    right: 0,
    backgroundColor: colors.surface, // Background for the options tray
    borderTopWidth: 1,
    borderColor: colors.border,
    paddingVertical: SPACING.small,
    flexDirection: 'row',
    flexWrap: 'wrap', // Allow buttons to wrap if needed
    justifyContent: 'space-around',
    alignItems: 'center',
    paddingHorizontal: SPACING.small,
    zIndex: 1, // Ensure it's above message list
    minHeight: 60,
  },
  attachmentOptionButton: { // Style for individual buttons within attachmentOptionsContainer
    padding: SPACING.small,
    borderRadius: SPACING.medium,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
    marginHorizontal: SPACING.xsmall,
  },
  attachmentOptionButtonText: { // Text style for individual buttons
    fontSize: FONT_SIZES.medium,
    color: colors.textPrimary,
  },
  mediaUploadIndicator: { // For when media is uploading
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: SPACING.small,
    paddingHorizontal: SPACING.medium,
    backgroundColor: colors.surface,
    borderRadius: SPACING.large,
    flex: 1,
  },
  mediaUploadText: {
    marginLeft: SPACING.small,
    color: colors.textSecondary,
    fontSize: FONT_SIZES.medium,
  },

  // Join Group Prompt (existing)
  joinPromptText: {
    fontSize: FONT_SIZES.medium,
    color: colors.textPrimary,
    textAlign: 'center',
    marginBottom: SPACING.medium,
  },
  joinButton: {
    backgroundColor: colors.primary,
    padding: SPACING.medium,
    borderRadius: SPACING.small,
    alignItems: "center",
    marginBottom: SPACING.medium,
  },
  joinButtonText: {
    color: colors.buttonText,
    fontWeight: "bold",
    fontSize: FONT_SIZES.large,
  },
    }),

 groupWalletScreen: StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
  headerContainer: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 16,
    borderBottomWidth: 1,
    borderColor: colors.borderColor,
  },
  backButton: {
    padding: 8,
  },
  headerTitle: {
    fontSize: FONT_SIZES.large,
    fontWeight: "bold",
    color: colors.textPrimary,
  },
  scrollContent: {
    padding: 20,
  },
  balanceCard: {
    alignItems: "center",
    paddingVertical: 30,
    borderRadius: 16,
    backgroundColor: colors.cardBackground,
    marginBottom: 20,
    elevation: 3,
    shadowColor: "#000",
    shadowOpacity: 0.1,
    shadowRadius: 6,
  },
  balanceLabel: {
    fontSize: FONT_SIZES.medium,
    color: colors.textSecondary,
  },
  balanceValue: {
    fontSize: FONT_SIZES.xlarge,
    fontWeight: "bold",
    color: colors.primary,
    marginTop: 10,
  },
  depositContainer: {
    marginVertical: 20,
    alignItems: "center",
  },
  depositButton: {
    width: "90%",
    paddingVertical: 14,
    borderRadius: 12,
    marginVertical: 8,
    alignItems: "center",
  },
  depositButtonText: {
    fontSize: FONT_SIZES.medium,
    color: "#fff",
    fontWeight: "bold",
  },
  historySection: {
    marginTop: 30,
    paddingHorizontal: 16,
  },
  historyTitle: {
    fontSize: FONT_SIZES.large,
    fontWeight: "bold",
    color: colors.textPrimary,
  },

  analyticsSection: {
  backgroundColor: colors.cardBackground,
  borderRadius: 12,
  padding: 16,
  marginVertical: 20,
  elevation: 2,
  shadowColor: "#000",
  shadowOpacity: 0.1,
  shadowRadius: 6,
},
analyticsText: {
  fontSize: FONT_SIZES.medium,
  color: colors.textSecondary,
  marginVertical: 3,
},

transactionItem: {
  flexDirection: "row",
  justifyContent: "space-between",
  alignItems: "center",
  backgroundColor: colors.cardBackground,
  padding: 20,
  borderRadius: 10,
  marginTop: 10,
  paddingLeft: 0,
  paddingRight: 0,
  shadowColor: "#000",
  shadowOpacity: 0.05,
  shadowRadius: 4,
},
transactionTitle: {
  color: colors.textPrimary,
  fontWeight: "bold",
  fontSize: FONT_SIZES.medium,
},
transactionSub: {
  color: colors.textSecondary,
  fontSize: FONT_SIZES.small,
  marginTop: 2,
},
transactionAmount: {
  fontWeight: "bold",
  fontSize: FONT_SIZES.medium,
},



}),
    groupDetailsScreen: StyleSheet.create({ // New style object for GroupDetailsScreen
      safeArea: {
        flex: 1,
        backgroundColor: colors.background,
      },
      scrollViewContent: {
        flexGrow: 1,
        padding: SPACING.medium,
        paddingBottom: SPACING.xxlarge,
      },
      headerContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: SPACING.medium,
        paddingHorizontal: SPACING.medium,
        borderBottomWidth: 1,
        borderBottomColor: colors.border,
        backgroundColor: colors.background,
        marginBottom: SPACING.small,
      },
      backButton: {
        padding: SPACING.xsmall,
        marginRight: SPACING.medium,
      },
      headerTitle: {
        fontSize: FONT_SIZES.heading3, // Smaller heading for detail screen
        fontWeight: 'bold',
        color: colors.textPrimary,
        flex: 1,
        textAlign: 'center',
      },
      editButton: {
        padding: SPACING.xsmall,
        marginLeft: SPACING.medium,
      },
      editButtonsContainer: {
        flexDirection: 'row',
        marginLeft: SPACING.medium,
      },
      saveButton: {
        backgroundColor: colors.primary,
        padding: SPACING.small,
        borderRadius: SPACING.small,
        alignItems: 'center',
        justifyContent: 'center',
      },
      cancelButton: {
        backgroundColor: colors.error,
        padding: SPACING.small,
        borderRadius: SPACING.small,
        alignItems: 'center',
        justifyContent: 'center',
      },
      detailSection: {
        marginBottom: SPACING.large,
        backgroundColor: colors.cardBackground,
        padding: SPACING.medium,
        borderRadius: SPACING.medium,
        borderWidth: 1,
        borderColor: colors.borderColor,
      },
      label: {
        fontSize: FONT_SIZES.medium,
        fontWeight: 'bold',
        color: colors.textSecondary,
        marginBottom: SPACING.small,
      },
      valueText: {
        fontSize: FONT_SIZES.large,
        color: colors.textPrimary,
      },
      input: {
        fontSize: FONT_SIZES.large,
        color: colors.textPrimary,
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: SPACING.small,
        padding: SPACING.small,
        backgroundColor: colors.cardBackground,
      },
      descriptionInput: {
        minHeight: 100,
        textAlignVertical: 'top',
      },
      membersList: {
        marginTop: SPACING.small,
      },
      memberItem: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: SPACING.small,
        paddingVertical: SPACING.xsmall,
        paddingHorizontal: SPACING.small,
        backgroundColor: colors.background,
        borderRadius: SPACING.small,
      },
      memberAvatar: {
        width: 40,
        height: 40,
        borderRadius: 20,
        marginRight: SPACING.medium,
        backgroundColor: colors.placeholder,
        justifyContent: 'center',
        alignItems: 'center',
      },
      memberAvatarFallback: {
        backgroundColor: colors.secondary,
      },
      memberAvatarFallbackText: {
        color: colors.buttonText,
        fontSize: FONT_SIZES.medium,
        fontWeight: 'bold',
      },
      memberName: {
        fontSize: FONT_SIZES.medium,
        color: colors.textPrimary,
        fontWeight: '500',
      },
    }),

    usersScreen: StyleSheet.create({
      // inside createStyles(colors)
  listContent: {
    padding: 10,
  },

  /** 🔹 Header at the top with title + profile */
  headerContainer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },

  pageTitle: {
    fontSize: FONT_SIZES.xlarge,
    fontWeight: "700",
    color: colors.textPrimary,
  },

  headerProgressRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 6,
    gap: 8,
  },
  headerProgressBg: {
    flex: 1,
    height: 5,
    borderRadius: 3,
    overflow: "hidden",
  },
  headerProgressFill: {
    height: "100%",
    borderRadius: 3,
  },
  headerProgressText: {
    fontSize: FONT_SIZES.xsmall,
    fontWeight: "600",
    minWidth: 28,
  },

  /** 🔹 User row card */
  userCard: {
    flexDirection: "row",
    alignItems: "center",
    padding: 12,
    marginHorizontal: 10,
    marginVertical: 6,
    borderRadius: 14,
    backgroundColor: colors.cardBackground,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
    elevation: 2,
  },

  userCardContent: {
    flex: 1,
    marginLeft: 12,
  },

  userCardUsername: {
    fontSize: FONT_SIZES.large,
    fontWeight: "600",
    color: colors.textPrimary,
    marginBottom: 2,
  },

  lastMessagePreview: {
    fontSize: FONT_SIZES.small,
    color: colors.textSecondary,
  },

  /** 🔹 Avatar styles */
  memberAvatar: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: colors.border,
  },

  memberAvatarFallback: {
    alignItems: "center",
    justifyContent: "center",
  },

  memberAvatarFallbackText: {
    fontSize: FONT_SIZES.large,
    color: colors.textPrimary,
    fontWeight: "700",
  },

  /** 🔹 Search bar */
  searchBar: {
    backgroundColor: colors.cardBackground || "#f2f2f2",
    color: colors.textPrimary,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    margin: 10,
    fontSize: FONT_SIZES.medium,
    borderWidth: 1,
    borderColor: colors.border,
  },

  /** 🔹 Empty state text */
  noResultsText: {
    textAlign: "center",
    color: colors.textSecondary,
    fontSize: FONT_SIZES.medium,
    marginTop: 30,
  },


 
  userAvatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
    marginBottom: SPACING.small,
    backgroundColor: colors.placeholder,
  },
  username: {
    fontSize: FONT_SIZES.medium,
    color: colors.textPrimary,
    textAlign: 'center',
  },

   memberItem: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: SPACING.small,
        paddingVertical: SPACING.xsmall,
        paddingHorizontal: SPACING.small,
        backgroundColor: colors.background,
        borderRadius: SPACING.small,
      },



      memberName: {
        fontSize: FONT_SIZES.medium,
        color: colors.textPrimary,
        fontWeight: '500',
      },
}),

businessChatScreen: StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  headerContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: SPACING.medium,
    paddingHorizontal: SPACING.large,
    backgroundColor: colors.primary, // Primary color for chat header
    paddingTop: Platform.OS === 'android' ? SPACING.large : SPACING.xxlarge, // Adjust for status bar
  },
  backButton: { // Back button in header
    paddingHorizontal: SPACING.small,
    paddingVertical: SPACING.small,
    marginRight: SPACING.medium,
  },
  headerImage: { // For business image in chat header
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.placeholder, // Placeholder background
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: SPACING.small,
  },
  headerImageText: { // Text for business initials fallback
    color: colors.buttonText,
    fontSize: FONT_SIZES.medium,
    fontWeight: 'bold',
  },
  headerTitle: { // Business name in header
    color: colors.activeFilterText,
    fontSize: FONT_SIZES.large,
    fontWeight: 'bold',
    flex: 1, // Take available space
  },
  viewProfileButton: { // Button to view business profile/details
    padding: SPACING.xsmall,
    marginLeft: SPACING.small,
  },
  messagesList: { // Content container style for FlatList of messages
    paddingVertical: SPACING.small,
    paddingHorizontal: SPACING.medium,
  },
  messageBubble: { // Base style for all message bubbles
    padding: SPACING.small,
    borderRadius: SPACING.medium,
    marginBottom: SPACING.small,
    maxWidth: '80%', // Max width for message bubble
    shadowColor: colors.shadowColor,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 1,
    elevation: 1,
  },
  myMessageBubble: { // Style for current user's messages
    alignSelf: 'flex-end', // Align to right
    backgroundColor: colors.primaryLight, // Lighter primary for own messages
    borderBottomRightRadius: SPACING.xsmall, // For message "tail"
  },
  otherMessageBubble: { // Style for other users/bot messages
    alignSelf: 'flex-start', // Align to left
    backgroundColor: colors.cardBackground, // Card background for others
    borderBottomLeftRadius: SPACING.xsmall, // For message "tail"
  },
  myMessageText: { // Text style for current user's messages
    color: colors.text, // Text on primaryLight background
    fontSize: FONT_SIZES.medium,
  },
  otherMessageText: { // Text style for other users/bot messages
    color: colors.text, // Text on cardBackground
    fontSize: FONT_SIZES.medium,
  },
  timestampText: { // Timestamp style
    fontSize: FONT_SIZES.xsmall,
    color: colors.secondaryText,
    alignSelf: 'flex-end',
    marginTop: SPACING.xsmall / 2,
  },
  messageAvatar: { // Avatar in message bubbles
    width: 30,
    height: 30,
    borderRadius: 15,
    marginHorizontal: SPACING.xsmall, // Space between avatar and bubble
    backgroundColor: colors.placeholder,
    borderWidth: 1,
    borderColor: colors.border,
  },
  messageContentWrapper: { // Wrapper for message text, media, and progress/error indicators
    flex: 1, // Allow content to take space
    // Padding and border radius come from messageBubble
  },

  // Media/File Message Styles
  mediaMessageImage: { // For images and video previews
    width: Dimensions.get('window').width * 0.6, // Relative width
    height: Dimensions.get('window').width * 0.45, // Aspect ratio
    borderRadius: SPACING.medium,
    marginBottom: SPACING.xsmall,
    resizeMode: 'cover',
  },
  videoMessageContainer: { // Container for video preview
    position: 'relative',
    borderRadius: SPACING.medium,
    overflow: 'hidden',
  },
  videoPlayText: { // Text overlay on video preview
    color: colors.activeFilterText,
    fontSize: FONT_SIZES.small,
    textAlign: 'center',
    position: 'absolute',
    top: 0,
    left: 0,
    width: '100%',
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.4)',
    borderRadius: SPACING.medium,
  },
  fileMessageContainer: { // Container for file messages
    flexDirection: 'row',
    alignItems: 'center',
    padding: SPACING.small,
    backgroundColor: colors.background, // Background for file bubble
    borderRadius: SPACING.medium,
    borderWidth: 1,
    borderColor: colors.border,
  },
  fileIcon: { // Icon for file messages
    marginRight: SPACING.small,
  },
  fileDetails: { // Container for file name and size
    flex: 1,
  },
  fileNameText: {
    fontSize: FONT_SIZES.medium,
    fontWeight: 'bold',
    color: colors.textPrimary,
  },
  fileSizeText: {
    fontSize: FONT_SIZES.small,
    color: colors.textSecondary,
  },
  uploadProgressBarContainer: { // Progress bar container for uploads
    width: '100%',
    height: SPACING.xsmall,
    backgroundColor: colors.borderColor,
    borderRadius: SPACING.xsmall / 2,
    overflow: 'hidden',
    marginTop: SPACING.xsmall,
  },
  uploadProgressBar: { // Actual progress bar fill
    height: '100%',
    backgroundColor: colors.primary,
    borderRadius: SPACING.xsmall / 2,
  },
  uploadProgressText: { // Text for upload progress percentage
    fontSize: FONT_SIZES.xsmall,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: SPACING.xsmall / 2,
  },
  messageErrorBubble: { // Style for messages that failed to upload
    backgroundColor: colors.error + '33', // Lighter error color with transparency
    borderColor: colors.error,
    borderWidth: 1,
  },
  uploadErrorText: { // Text for upload error message
    fontSize: FONT_SIZES.small,
    color: colors.error,
    marginTop: SPACING.xsmall,
  },

  // Input Area Styles
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: SPACING.small,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.borderColor,
    // Shadows for input container
    ...Platform.select({
      ios: {
        shadowColor: colors.shadowColor,
        shadowOffset: { width: 0, height: -2 },
        shadowOpacity: 0.1,
        shadowRadius: 4,
      },
      android: {
        elevation: 8,
      },
      web: {
        boxShadow: `0px -2px 4px ${colors.shadowColor}1A`,
      },
    }),
  },
  textInput: { // Main text input field
    flex: 1,
    minHeight: 40,
    maxHeight: 120, // Limit height for multiline input
    backgroundColor: colors.background,
    borderRadius: SPACING.large,
    paddingHorizontal: SPACING.medium,
    paddingVertical: SPACING.small,
    marginRight: SPACING.small,
    fontSize: FONT_SIZES.medium,
    color: colors.textPrimary,
    borderWidth: 1,
    borderColor: colors.border,
  },
  sendButton: { // Send button
    minHeight: 40,
    backgroundColor: colors.primary,
    borderRadius: SPACING.large, // Pill shape
    paddingVertical: SPACING.medium - 2, // Adjusted padding
    paddingHorizontal: SPACING.large,
    justifyContent: 'center',
    alignItems: 'center',
    ...Platform.select({
      ios: {
        shadowColor: colors.shadowColor,
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.25,
        shadowRadius: 3.84,
      },
      android: {
        elevation: 5,
      },
      web: {
        boxShadow: `0px 2px 3.84px ${colors.shadowColor}40`,
      },
    }),
  },
  sendButtonText: {
    color: colors.activeFilterText,
    fontWeight: 'bold',
    fontSize: FONT_SIZES.medium,
  },

  // Attachment Options Container
  attachmentOptionsContainer: {
    position: 'absolute',
    bottom: '100%', // Position directly above inputContainer
    width: '100%',
    left: 0,
    right: 0,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderColor: colors.border,
    paddingVertical: SPACING.small,
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-around',
    alignItems: 'center',
    paddingHorizontal: SPACING.small,
    zIndex: 1, // Ensure it's above message list
    minHeight: 60,
  },
  attachmentOptionButton: {
    padding: SPACING.small,
    borderRadius: SPACING.medium,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
    marginHorizontal: SPACING.xsmall,
  },
  attachmentOptionButtonText: {
    fontSize: FONT_SIZES.medium,
    color: colors.textPrimary,
  },
  mediaUploadIndicator: { // For when media is uploading
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: SPACING.small,
    paddingHorizontal: SPACING.medium,
    backgroundColor: colors.surface,
    borderRadius: SPACING.large,
    flex: 1,
  },
  mediaUploadText: {
    marginLeft: SPACING.small,
    color: colors.textSecondary,
    fontSize: FONT_SIZES.medium,
  },

  // Emoji Picker Styles (if used)
  emojiPickerContainer: {
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderColor: colors.border,
    height: 200, // Fixed height for picker
    padding: SPACING.small,
  },
  emojiListContent: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  emojiItem: {
    padding: SPACING.xsmall,
    margin: SPACING.xsmall,
    borderRadius: SPACING.small,
    backgroundColor: colors.background,
  },
  emojiText: {
    fontSize: FONT_SIZES.xxlarge,
  },
  emojiButton: { // Button to toggle emoji picker
    padding: SPACING.small,
    borderRadius: SPACING.medium,
    backgroundColor: colors.primaryLight, // Lighter background for emoji button
    marginRight: SPACING.small,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emojiButtonText: {
    fontSize: FONT_SIZES.large,
  },
}),

myBusinessScreen: StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  headerContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: SPACING.medium,
    paddingHorizontal: SPACING.medium,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderColor,
    backgroundColor: colors.background,
  },
  sectionHeader: {
  fontSize: FONT_SIZES.large,
  fontWeight: 'bold',
  color: colors.textPrimary,
  marginBottom: SPACING.small,
  marginTop: SPACING.large,
  alignSelf: 'flex-start',
},
  headerTitle: {
    fontSize: FONT_SIZES.heading2,
    fontWeight: 'bold',
    color: colors.textPrimary,
  },
  addButton: {
    backgroundColor: colors.primary,
    borderRadius: SPACING.large,
    paddingVertical: SPACING.small,
    paddingHorizontal: SPACING.medium,
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 3,
    shadowColor: colors.shadowColor,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 2,
  },
  pageTitle: {
  fontSize: FONT_SIZES.heading2,
  fontWeight: 'bold',
  color: colors.textPrimary,
  paddingVertical: SPACING.medium,
  paddingHorizontal: SPACING.medium,
},
label: {
    color: colors.secondaryText,
    fontSize: FONT_SIZES.small,
    marginTop: 8,
    fontWeight: "600",
  },
  value: {
    color: colors.textPrimary,
    fontSize: FONT_SIZES.medium,
  },
  backButton: {
    padding: 6,
  },
  editButton: {
    padding: 6,
  },
  businessImageWrapper: {
    alignSelf: "center",
    marginVertical: 16,
    width: 100,
    height: 100,
    borderRadius: 50,
    overflow: "hidden",
    backgroundColor: colors.surface,
    justifyContent: "center",
    alignItems: "center",
  },
  businessImage: {
    width: "100%",
    height: "100%",
    resizeMode: "cover",
  },
  businessImageFallback: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: colors.primaryLight,
    justifyContent: "center",
    alignItems: "center",
  },
  businessImageFallbackText: {
    color: colors.primary,
    fontWeight: "bold",
    fontSize: FONT_SIZES.xxlarge,
  },
  infoContainer: {
    marginHorizontal: 16,
    padding: 12,
    backgroundColor: colors.cardBackground,
    borderRadius: 12,
  },

noResultsText: {
  textAlign: 'center',
  marginTop: SPACING.large,
  fontSize: FONT_SIZES.medium,
  color: colors.secondaryText,
  paddingHorizontal: SPACING.medium,
},

catalogDescription: {
  textAlign: 'center',
  fontSize: FONT_SIZES.medium,
  color: colors.secondaryText,
  marginVertical: SPACING.small,
  paddingHorizontal: SPACING.medium,
},

flatListContent: {
  paddingBottom: SPACING.large + 80, // room for FAB or tab bar
  paddingHorizontal: SPACING.medium,
  paddingTop: SPACING.small,
},

flatListStyle: {
  flexGrow: 1,
  backgroundColor: colors.background,
},

  addButtonText: {
    color: colors.buttonText,
    fontSize: FONT_SIZES.medium,
    fontWeight: 'bold',
  },
  businessList: {
    paddingHorizontal: SPACING.medium,
    paddingBottom: SPACING.large,
  },
  businessCard: {
    backgroundColor: colors.cardBackground,
    borderRadius: SPACING.large,
    padding: SPACING.medium,
    marginBottom: SPACING.medium,
    flexDirection: 'row',
    alignItems: 'center',
    elevation: 2,
    shadowColor: colors.shadowColor,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 1,
  },
  businessImageContainer: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: colors.surface,
    overflow: 'hidden',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: SPACING.medium,
  },

  businessInitialsFallback: {
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.primaryLight,
    width: '100%',
    height: '100%',
  },
  businessInitialsText: {
    color: colors.primary,
    fontWeight: 'bold',
    fontSize: FONT_SIZES.large,
  },
  businessInfo: {
    flex: 1,
  },
  businessName: {
    fontSize: FONT_SIZES.large,
    fontWeight: 'bold',
    color: colors.textPrimary,
    marginBottom: SPACING.xsmall,
  },
  businessDescription: {
    color: colors.secondaryText,
    fontSize: FONT_SIZES.medium,
    marginBottom: SPACING.xsmall,
  },
  businessMeta: {
    color: colors.secondaryText,
    fontSize: FONT_SIZES.small,
  },
  noBusinessesText: {
    textAlign: 'center',
    color: colors.secondaryText,
    fontSize: FONT_SIZES.medium,
    marginTop: SPACING.large,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: SPACING.small,
    fontSize: FONT_SIZES.medium,
    color: colors.secondaryText,
  },
}),




ehailingScreen: StyleSheet.create({
  // layout
  container: {
    flex: 1,
    paddingHorizontal: 16,
    paddingBottom: 16,
    backgroundColor: colors.background,
  },

  // text
  title: {
    fontSize: 22,
    fontWeight: "700",
    color: colors.textPrimary,
    marginTop: 12,
    marginBottom: 10,
  },
  subtitle: {
    fontSize: 18,
    fontWeight: "600",
    color: colors.textPrimary,
    marginTop: 6,
    marginBottom: 8,
  },
  subtitleSmall: {
    fontSize: 14,
    fontWeight: "500",
    color: colors.textSecondary,
  },

  // rows
  rowBetween: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginVertical: 8,
  },

  // inputs
  inputRow: { marginBottom: 8 },
  inputContainer: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.cardBackground,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: colors.borderColor, // visible border
  },
  input: {
    flex: 1,
    marginLeft: 8,
    fontSize: 14,
    color: colors.textPrimary, // ensure text visible on light/dark
  },

  // map
  mapWrapper: {
    width: "100%",
    height: height * 0.35,
    borderRadius: 16,
    overflow: "hidden",
    marginVertical: 12,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderColor,
  },
  map: { flex: 1 },

  // ride cards (bigger)
  cardLarge: {
    backgroundColor: colors.cardBackground,
    padding: 16,
    borderRadius: 14,
    marginRight: 14,
    minWidth: width * 0.55,
    shadowColor: colors.shadowColor,
    shadowOpacity: 0.06,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
    borderWidth: 1,
    borderColor: colors.borderColor,
  },
  cardSelected: {
    borderColor: colors.primary,
    borderWidth: 2,
    backgroundColor: colors.surface,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: colors.textPrimary,
    marginBottom: 4,
  },
  cardMeta: {
    fontSize: 13,
    color: colors.textSecondary,
  },

  // buttons
  button: {
    backgroundColor: colors.primary,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: "center",
    marginTop: 12,
  },
  buttonDisabled: {
    backgroundColor: colors.primaryLight,
  },
  buttonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "700",
  },

  // small pill for online toggle
  smallPill: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.borderColor,
  },

  sheet: {
  position: "absolute",
  left: 0,
  right: 0,
  bottom: 0,
  backgroundColor: colors.cardBackground,
  borderTopLeftRadius: 16,
  borderTopRightRadius: 16,
  borderWidth: 1,
  borderColor: colors.borderColor,
  // elevation + shadow
  shadowColor: colors.shadowColor,
  shadowOpacity: 0.18,
  shadowRadius: 12,
  shadowOffset: { width: 0, height: -4 },
  elevation: 20,
  paddingHorizontal: 16,
  paddingTop: 6,
  zIndex: 50,
},

grabberArea: {
  alignItems: "center",
  paddingVertical: 8,
},

grabber: {
  width: 42,
  height: 4,
  borderRadius: 2,
  opacity: 0.5,
},

}),


beADriverScreen: StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    padding: 16,
  },
  title: {
    fontSize: 22,
    fontWeight: "700",
    marginBottom: 12,
    color: colors.text,
  },
  label: {
    fontSize: 13,
    color: colors.muted || "#6B7280",
    marginTop: 8,
    marginBottom: 4,
  },
  input: {
    backgroundColor: colors.card || "#F3F4F6",
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 10,
    color: colors.text,
  },
  uploadRow: {
    flexDirection: "row",
    gap: 10,
    marginTop: 12,
  },
  uploadBox: {
    flex: 1,
    backgroundColor: colors.card || "#F3F4F6",
    borderRadius: 10,
    padding: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  uploadText: {
    color: colors.text,
    fontWeight: "600",
  },
  previewRow: {
    flexDirection: "row",
    gap: 10,
    marginTop: 10,
  },
  preview: {
    width: 90,
    height: 90,
    borderRadius: 8,
  },
  submitButton: {
    backgroundColor: colors.primary || "#2563EB",
    borderRadius: 12,
    alignItems: "center",
    paddingVertical: 14,
    marginTop: 16,
  },
  submitText: {
    color: colors.buttonText || "#fff",
    fontWeight: "700",
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  hint: {
    fontSize: 12,
    color: colors.muted || "#6B7280",
    marginTop: 10,
  },
  safeArea: {
  flex: 1,
  backgroundColor: colors.background,
},

}),


chatRoomScreen: StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },

 
  /** HEADER */
  headerContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: SPACING.medium,
    paddingHorizontal: SPACING.medium,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.background,
    marginBottom: SPACING.small,
  },
  backButton: {
    padding: SPACING.xsmall,
    marginRight: SPACING.small,
  },
  recipientProfilePic: {
    width: 40,
    height: 40,
    borderRadius: 20,
    marginLeft: SPACING.medium,
    backgroundColor: colors.secondary,
    justifyContent: 'center',
    alignItems: 'center',

  },
  headerTitle: {
    fontSize: FONT_SIZES.large,
    fontWeight: "bold",
    color: colors.textPrimary,
    flex: 1,
  },

  profileButton: {
  flexDirection: 'row',
  alignItems: 'center',
  marginRight: SPACING.small,
},

  /** MESSAGES LIST */
  messagesList: {
    paddingVertical: SPACING.small,
    paddingHorizontal: SPACING.medium,
  },
  messageBubble: {
    padding: SPACING.medium,
    borderRadius: SPACING.large,
    marginBottom: SPACING.small,
    maxWidth: '80%',
    backgroundColor: colors.cardBackground,
    shadowColor: colors.shadowColor,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 1,
    elevation: 1,
  },
  myMessageBubble: {
    alignSelf: 'flex-end',
    backgroundColor: colors.primaryLight,
    borderBottomRightRadius: SPACING.small,
  },
  otherMessageBubble: {
    alignSelf: 'flex-start',
    backgroundColor: colors.surface,
    borderBottomLeftRadius: SPACING.small,
  },
  myMessageText: {
    color: colors.text,
    fontSize: FONT_SIZES.medium,
  },
  otherMessageText: {
    color: colors.text,
    fontSize: FONT_SIZES.medium,
  },
  timestampText: {
    fontSize: FONT_SIZES.xsmall,
    color: colors.secondaryText,
    alignSelf: 'flex-end',
    marginTop: SPACING.xsmall / 2,
  },

  /** INPUT AREA */
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: SPACING.small,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.borderColor,
    elevation: 8,
    shadowColor: colors.shadowColor,
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
  },
  textInput: {
    flex: 1,
    minHeight: 40,
    maxHeight: 120,
    backgroundColor: colors.background,
    borderRadius: SPACING.large,
    paddingHorizontal: SPACING.medium,
    paddingVertical: SPACING.small,
    marginRight: SPACING.small,
    fontSize: FONT_SIZES.medium,
    color: colors.text,
    borderWidth: 1,
    borderColor: colors.borderColor,
  },
  sendButton: {
    minHeight: 40,
    backgroundColor: colors.primary,
    borderRadius: SPACING.large,
    paddingVertical: SPACING.medium - 2,
    paddingHorizontal: SPACING.large,
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 4,
    shadowColor: colors.shadowColor,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 2,
  },
  sendButtonText: {
    color: colors.activeFilterText,
    fontWeight: 'bold',
    fontSize: FONT_SIZES.medium,
  },

  /** ATTACHMENT & EMOJI BUTTONS */
  attachmentButton: {
    minHeight: 40,
    padding: SPACING.small,
    borderRadius: SPACING.medium,
    backgroundColor: colors.primaryLight,
    marginRight: SPACING.xsmall,
    alignItems: 'center',
    justifyContent: 'center',
  },
  attachmentButtonText: {
    fontSize: FONT_SIZES.large,
  },
  emojiButton: {
    padding: SPACING.small,
    borderRadius: SPACING.medium,
    backgroundColor: colors.primaryLight,
    marginRight: SPACING.xsmall,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emojiButtonText: {
    fontSize: FONT_SIZES.large,
  },
  catalogItem: {
  flexDirection: 'row',
  alignItems: 'center',
  backgroundColor: colors.cardBackground,
  padding: SPACING.medium,
  borderRadius: SPACING.large,
  marginRight: SPACING.small,
  elevation: 2,
  shadowColor: colors.shadowColor,
  shadowOffset: { width: 0, height: 1 },
  shadowOpacity: 0.1,
  shadowRadius: 2,
},
catalogImage: {
  width: 50,
  height: 50,
  borderRadius: SPACING.medium,
  marginRight: SPACING.small,
},


  /** MEDIA & FILES */
  mediaMessageImage: {
    width: Dimensions.get('window').width * 0.6,
    height: Dimensions.get('window').width * 0.45,
    borderRadius: SPACING.medium,
    marginBottom: SPACING.xsmall,
    resizeMode: 'cover',
  },
  videoMessageContainer: {
    position: 'relative',
    borderRadius: SPACING.medium,
    overflow: 'hidden',
  },
  videoPlayText: {
    color: colors.activeFilterText,
    fontSize: FONT_SIZES.small,
    textAlign: 'center',
    position: 'absolute',
    top: 0,
    left: 0,
    width: '100%',
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.4)',
    borderRadius: SPACING.medium,
  },
  fileMessageContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: SPACING.small,
    backgroundColor: colors.background,
    borderRadius: SPACING.medium,
    borderWidth: 1,
    borderColor: colors.borderColor,
  },
  fileIcon: {
    fontSize: FONT_SIZES.xxlarge,
    marginRight: SPACING.small,
  },
  fileDetails: {
    flex: 1,
  },
  fileNameText: {
    fontSize: FONT_SIZES.medium,
    fontWeight: 'bold',
    color: colors.text,
  },
  fileSizeText: {
    fontSize: FONT_SIZES.small,
    color: colors.secondaryText,
  },

  /** UPLOAD / ERRORS */
  uploadProgressBarContainer: {
    width: '100%',
    height: SPACING.small,
    backgroundColor: colors.borderColor,
    borderRadius: SPACING.small / 2,
    overflow: 'hidden',
    marginTop: SPACING.xsmall,
  },
  uploadProgressBar: {
    height: '100%',
    backgroundColor: colors.primary,
    borderRadius: SPACING.small / 2,
  },
  uploadProgressText: {
    fontSize: FONT_SIZES.xsmall,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: SPACING.xsmall / 2,
  },
  messageErrorBubble: {
    backgroundColor: colors.error + '33',
    borderColor: colors.error,
    borderWidth: 1,
  },
  uploadErrorText: {
    fontSize: FONT_SIZES.small,
    color: colors.error,
    marginTop: SPACING.xsmall,
  },

  /** ATTACHMENT OPTIONS */
  attachmentOptionsContainer: {
    position: 'absolute',
    bottom: '100%',
    width: '100%',
    left: 0,
    right: 0,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderColor: colors.borderColor,
    paddingVertical: SPACING.small,
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-around',
    alignItems: 'center',
    paddingHorizontal: SPACING.small,
    zIndex: 1,
    minHeight: 60,
  },
  attachmentOptionButton: {
    padding: SPACING.small,
    borderRadius: SPACING.medium,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.borderColor,
    marginHorizontal: SPACING.xsmall,
  },
  attachmentOptionButtonText: {
    fontSize: FONT_SIZES.medium,
    color: colors.text,
  },

  /** EMOJI PICKER */
  emojiPickerContainer: {
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderColor: colors.borderColor,
    height: 200,
    padding: SPACING.small,
  },
  emojiListContent: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  emojiItem: {
    padding: SPACING.xsmall,
    margin: SPACING.xsmall,
    borderRadius: SPACING.small,
    backgroundColor: colors.background,
  },
  emojiText: {
    fontSize: FONT_SIZES.xxlarge,
  },
  mediaUploadIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: SPACING.small,
    paddingHorizontal: SPACING.medium,
    backgroundColor: colors.surface,
    borderRadius: SPACING.large,
    flex: 1,
  },
  mediaUploadText: {
    marginLeft: SPACING.small,
    color: colors.textSecondary,
    fontSize: FONT_SIZES.medium,
  },
}),

  };
};

export default createStyles;