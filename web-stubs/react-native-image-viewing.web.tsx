// Web-compatible stub for react-native-image-viewing
import React from 'react';
import { Modal, View, Image, TouchableOpacity, Text, StyleSheet } from 'react-native';

interface ImageViewingProps {
  images: { uri: string }[];
  imageIndex?: number;
  visible: boolean;
  onRequestClose: () => void;
  onImageIndexChange?: (index: number) => void;
  swipeToCloseEnabled?: boolean;
  doubleTapToZoomEnabled?: boolean;
  animationType?: "fade" | "none" | "slide";
  backgroundColor?: string;
  FooterComponent?: React.ComponentType;
  renderImage?: (props: { source: { uri: string } }) => React.ReactNode;
}

const ImageViewing: React.FC<ImageViewingProps> = ({
  images,
  imageIndex = 0,
  visible,
  onRequestClose,
  onImageIndexChange,
  backgroundColor = 'rgba(0, 0, 0, 0.95)',
  FooterComponent,
}) => {
  const [currentIndex, setCurrentIndex] = React.useState(imageIndex);

  React.useEffect(() => {
    setCurrentIndex(imageIndex || 0);
  }, [imageIndex]);

  const handlePrevious = () => {
    if (currentIndex > 0) {
      const newIndex = currentIndex - 1;
      setCurrentIndex(newIndex);
      onImageIndexChange?.(newIndex);
    }
  };

  const handleNext = () => {
    if (currentIndex < images.length - 1) {
      const newIndex = currentIndex + 1;
      setCurrentIndex(newIndex);
      onImageIndexChange?.(newIndex);
    }
  };

  if (!visible || images.length === 0) return null;

  const currentImage = images[currentIndex];

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onRequestClose}
    >
      <View style={[styles.container, { backgroundColor }]}>
        <TouchableOpacity
          style={styles.closeButton}
          onPress={onRequestClose}
        >
          <Text style={styles.closeButtonText}>✕</Text>
        </TouchableOpacity>

        <View style={styles.imageContainer}>
          <Image
            source={{ uri: currentImage.uri }}
            style={styles.image}
            resizeMode="contain"
          />
        </View>

        {images.length > 1 && (
          <>
            {currentIndex > 0 && (
              <TouchableOpacity
                style={[styles.navButton, styles.prevButton]}
                onPress={handlePrevious}
              >
                <Text style={styles.navButtonText}>‹</Text>
              </TouchableOpacity>
            )}
            {currentIndex < images.length - 1 && (
              <TouchableOpacity
                style={[styles.navButton, styles.nextButton]}
                onPress={handleNext}
              >
                <Text style={styles.navButtonText}>›</Text>
              </TouchableOpacity>
            )}
          </>
        )}

        {FooterComponent && (
          <View style={styles.footer}>
            <FooterComponent />
          </View>
        )}
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  closeButton: {
    position: 'absolute',
    top: 40,
    right: 20,
    zIndex: 10,
    padding: 10,
  },
  closeButtonText: {
    color: 'white',
    fontSize: 30,
    fontWeight: 'bold',
  },
  imageContainer: {
    flex: 1,
    width: '100%',
    justifyContent: 'center',
    alignItems: 'center',
  },
  image: {
    width: '100%',
    height: '100%',
  },
  navButton: {
    position: 'absolute',
    top: '50%',
    padding: 15,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    borderRadius: 25,
  },
  prevButton: {
    left: 20,
  },
  nextButton: {
    right: 20,
  },
  navButtonText: {
    color: 'white',
    fontSize: 40,
    fontWeight: 'bold',
  },
  footer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
  },
});

export default ImageViewing;
