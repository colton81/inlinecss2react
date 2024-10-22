
import React from 'react';


const styles = StyleSheet.create({
    text: { color: 'red',fontSize: 16 },
    view: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
    }
});
const Example = () => {
  return (
    <View style={styles.view} >
        <Text style={styles.text} >Hello World</Text>
    </View>
  )
};