'use client';

import { Redirect } from 'expo-router';
import { useState, useEffect } from 'react';
import { View, Image } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import splitLogo from '@/assets/images/splitmate-logo.png';

const App = () => {
  const [ isLoading, setIsLoading ] = useState( true );

  useEffect( () => {
    const timer = setTimeout( () => {
      setIsLoading( false );
    }, 90500 );

    return () => clearTimeout( timer );
  }, [] );

  if ( isLoading ) {
    return (
      <SafeAreaView className="flex-1 justify-center items-center bg-white">
        <View className="justify-center items-center">
          <Image
            source={ splitLogo }
            className="w-72 h-72"
            style={ { resizeMode: "contain" } }
          />
        </View>
      </SafeAreaView>
    );
  }

  return <Redirect href="/dashboard" />;
};

export default App;
