import { View, Text, TouchableOpacity, ScrollView, StatusBar, Image } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const Dashboard = () => {
  const insets = useSafeAreaInsets();

  const handleCalculationPress = ( title: string ) => {
    //TODO: Implementar navegación
    console.log( `Navegando a: ${ title }` );
  };

  return (
    <View className="flex-1 bg-gray-50" style={ { paddingTop: insets.top } }>
      <StatusBar barStyle="dark-content" backgroundColor="transparent" translucent={ true } />

      {/* Header */ }
      <View className="flex-row justify-between items-center px-2 py-4 bg-white shadow-lg border-b border-gray-100">
        <View className="flex-row items-center">
          <View className="w-12 h-12 bg-gradient-to-r from-purple-500 to-blue-500 rounded-full items-center justify-center shadow-md">
          </View>
          <Text className="text-2xl font-bold text-gray-800 ml-3 tracking-tight">MediCalc</Text>
        </View>
        <TouchableOpacity className="w-12 h-12 bg-gray-50 rounded-full items-center justify-center active:bg-gray-100 shadow-sm">
          <Ionicons name="settings-outline" size={ 24 } color="#6b7280" />
        </TouchableOpacity>
      </View>

      {/* Main Content */ }
      <ScrollView
        className="flex-1"
        contentContainerStyle={ { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 20 } }
        showsVerticalScrollIndicator={ false }
      >
        {/* Section Title */ }
        <Text className="text-xl font-semibold text-gray-800 mb-4">Cálculos</Text>

        {/* Calculation Grid */ }
      </ScrollView>

      {/* Bottom Navigation */ }
      <View
        className="flex-row bg-white border-t border-gray-200 px-4"
        style={ {
          paddingBottom: Math.max( insets.bottom, 8 ),
          paddingTop: 12,
        } }
      >
        <TouchableOpacity className="flex-1 items-center py-1">
          <Ionicons name="calculator" size={ 24 } color="#3b82f6" />
          <Text className="text-xs text-blue-500 mt-1 font-medium">Cálculos</Text>
        </TouchableOpacity>

        <TouchableOpacity className="flex-1 items-center py-1">
          <Ionicons name="heart-outline" size={ 24 } color="#9ca3af" />
          <Text className="text-xs text-gray-500 mt-1">Favoritos</Text>
        </TouchableOpacity>

        <TouchableOpacity className="flex-1 items-center py-1">
          <Ionicons name="document-text-outline" size={ 24 } color="#9ca3af" />
          <Text className="text-xs text-gray-500 mt-1">Protocolos</Text>
        </TouchableOpacity>

        <TouchableOpacity className="flex-1 items-center py-1">
          <Ionicons name="person-outline" size={ 24 } color="#9ca3af" />
          <Text className="text-xs text-gray-500 mt-1">Perfil</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

export default Dashboard;
