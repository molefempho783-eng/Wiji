// Web-compatible stub for react-native-pager-view
import React, { useRef, useState, useEffect } from 'react';
import { ScrollView, View, StyleSheet, NativeSyntheticEvent, NativeScrollEvent } from 'react-native';

interface PagerViewProps {
  children: React.ReactNode;
  style?: any;
  initialPage?: number;
  onPageSelected?: (e: { nativeEvent: { position: number } }) => void;
  ref?: any;
}

const PagerView = React.forwardRef<any, PagerViewProps>((props, ref) => {
  const { children, style, initialPage = 0, onPageSelected } = props;
  const scrollViewRef = useRef<ScrollView>(null);
  const [currentPage, setCurrentPage] = useState(initialPage);
  const { width } = require('react-native').Dimensions.get('window');

  React.useImperativeHandle(ref, () => ({
    setPage: (page: number) => {
      scrollViewRef.current?.scrollTo({ x: page * width, animated: true });
    },
  }));

  const handleScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const offsetX = event.nativeEvent.contentOffset.x;
    const page = Math.round(offsetX / width);
    if (page !== currentPage) {
      setCurrentPage(page);
      onPageSelected?.({ nativeEvent: { position: page } });
    }
  };

  useEffect(() => {
    if (initialPage > 0) {
      scrollViewRef.current?.scrollTo({ x: initialPage * width, animated: false });
    }
  }, []);

  const childrenArray = React.Children.toArray(children);

  return (
    <ScrollView
      ref={scrollViewRef}
      horizontal
      pagingEnabled
      showsHorizontalScrollIndicator={false}
      onScroll={handleScroll}
      scrollEventThrottle={16}
      style={[styles.container, style]}
    >
      {childrenArray.map((child, index) => (
        <View key={index} style={[styles.page, { width }]}>
          {child}
        </View>
      ))}
    </ScrollView>
  );
});

PagerView.displayName = 'PagerView';

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  page: {
    flex: 1,
  },
});

export default PagerView;
